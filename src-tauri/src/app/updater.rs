//! 自动更新（tauri-plugin-updater，替代 electron-updater）。
//! 暴露 getAppVersion / checkForUpdates / quitAndInstall，状态通过 app:update-status 事件推送。
//! 注：更新源 endpoints 与签名 pubkey 属部署配置（tauri.conf.json 的 plugins.updater），
//! 未配置时 check() 会报错，对齐原版「仅打包后可更新」的行为。

use crate::channels;
use crate::ipc::{into_ipc, IpcResult};
use serde_json::json;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

fn is_packaged() -> bool {
    !cfg!(debug_assertions)
}

#[tauri::command]
pub fn app_get_version(app: AppHandle) -> IpcResult<serde_json::Value> {
    IpcResult::ok(json!({
        "version": app.package_info().version.to_string(),
        "isPackaged": is_packaged(),
    }))
}

async fn check_inner(app: AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let _ = app.emit(channels::UPDATE_STATUS, json!({ "kind": "checking" }));
    match updater.check().await {
        Ok(Some(update)) => {
            let version = update.version.clone();
            let body = update.body.clone();
            let _ = app.emit(
                channels::UPDATE_STATUS,
                json!({ "kind": "available", "version": version, "releaseNotes": body }),
            );
            // 自动下载并安装（对齐 autoDownload + autoInstallOnAppQuit）
            let app_p = app.clone();
            let mut downloaded: u64 = 0;
            let res = update
                .download_and_install(
                    move |chunk, total| {
                        downloaded += chunk as u64;
                        let percent = total
                            .map(|t| if t > 0 { (downloaded as f64 / t as f64 * 100.0).round() as i64 } else { 0 })
                            .unwrap_or(0);
                        let _ = app_p.emit(
                            channels::UPDATE_STATUS,
                            json!({ "kind": "progress", "percent": percent, "transferred": downloaded, "total": total }),
                        );
                    },
                    || {},
                )
                .await;
            match res {
                Ok(_) => {
                    let _ = app.emit(
                        channels::UPDATE_STATUS,
                        json!({ "kind": "downloaded", "version": update.version }),
                    );
                    Ok(())
                }
                Err(e) => {
                    let _ = app.emit(
                        channels::UPDATE_STATUS,
                        json!({ "kind": "error", "message": e.to_string() }),
                    );
                    Err(e.to_string())
                }
            }
        }
        Ok(None) => {
            let _ = app.emit(channels::UPDATE_STATUS, json!({ "kind": "not-available" }));
            Ok(())
        }
        Err(e) => {
            let _ = app.emit(
                channels::UPDATE_STATUS,
                json!({ "kind": "error", "message": e.to_string() }),
            );
            Err(e.to_string())
        }
    }
}

#[tauri::command]
pub async fn app_check_updates(app: AppHandle) -> IpcResult<()> {
    if !is_packaged() {
        return IpcResult::err("updates only in packaged app");
    }
    into_ipc(check_inner(app).await)
}

#[tauri::command]
pub fn app_quit_install(app: AppHandle) -> IpcResult<()> {
    if !is_packaged() {
        return IpcResult::err("not packaged");
    }
    app.restart();
}
