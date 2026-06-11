//! 打开容器日志 / 终端 / 文件浏览子窗口。复用同一前端 index.html，靠 hash 路由区分。
//! 对齐 electron/main/index.ts 的 createLogWindow/createExecWindow/createFilesWindow。

use crate::ipc::{into_ipc, IpcResult};
use tauri::{AppHandle, WebviewUrl, WebviewWindowBuilder};
use uuid::Uuid;

fn urlencode(s: &str) -> String {
    // 仅对 hash 路由里可能出现的少量字符转义即可
    s.chars()
        .flat_map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '-' | '_' | '.' | '~' => vec![c],
            _ => format!("%{:02X}", c as u32).chars().collect(),
        })
        .collect()
}

fn open_window(
    app: &AppHandle,
    prefix: &str,
    hash: String,
    size: (f64, f64),
    min: (f64, f64),
) -> Result<(), String> {
    let label = format!("{prefix}-{}", Uuid::new_v4());
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App(format!("index.html#{hash}").into()))
        .title("Docker Browser")
        .inner_size(size.0, size.1)
        .min_inner_size(min.0, min.1)
        .build()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn app_open_logs_window(app: AppHandle, container_id: String) -> IpcResult<()> {
    let id = container_id.trim();
    if id.is_empty() {
        return IpcResult::err("invalid container id");
    }
    let hash = format!("logs?containerId={}", urlencode(id));
    into_ipc(open_window(&app, "logs", hash, (920.0, 640.0), (400.0, 280.0)))
}

#[tauri::command]
pub fn app_open_exec_window(app: AppHandle, container_id: String) -> IpcResult<()> {
    let id = container_id.trim();
    if id.is_empty() {
        return IpcResult::err("invalid container id");
    }
    let hash = format!("exec?containerId={}", urlencode(id));
    into_ipc(open_window(&app, "exec", hash, (960.0, 720.0), (520.0, 360.0)))
}

#[tauri::command]
pub fn app_open_files_window(
    app: AppHandle,
    container_id: String,
    initial_path: Option<String>,
) -> IpcResult<()> {
    let id = container_id.trim();
    if id.is_empty() {
        return IpcResult::err("invalid container id");
    }
    let initial = initial_path
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "/".into());
    let initial = if initial.starts_with('/') {
        initial
    } else {
        format!("/{initial}")
    };
    let hash = format!(
        "files?containerId={}&path={}",
        urlencode(id),
        urlencode(&initial)
    );
    into_ipc(open_window(&app, "files", hash, (920.0, 640.0), (400.0, 280.0)))
}
