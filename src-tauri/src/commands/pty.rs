use crate::docker_path::{env_with_docker_cli_in_path, resolve_docker_bin};
use crate::error::Result;
use crate::pty_session::{PtySession, PtySessions};
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use std::io::Read;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

static PTY_SESSIONS: std::sync::OnceLock<PtySessions> = std::sync::OnceLock::new();

fn pty_sessions() -> &'static PtySessions {
    PTY_SESSIONS.get_or_init(PtySessions::new)
}

#[derive(Serialize)]
pub struct PtyStartResult {
    #[serde(rename = "subscriptionId")]
    pub subscription_id: String,
}

#[derive(Serialize, Clone)]
struct PtyData {
    #[serde(rename = "subscriptionId")]
    subscription_id: String,
    data: String,
}

#[derive(Serialize, Clone)]
struct PtyExit {
    #[serde(rename = "subscriptionId")]
    subscription_id: String,
    #[serde(rename = "exitCode")]
    exit_code: i32,
}

#[tauri::command]
pub async fn exec_pty_start(
    app: AppHandle,
    container_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<PtyStartResult> {
    let cols = cols.unwrap_or(80).clamp(2, 400);
    let rows = rows.unwrap_or(24).clamp(2, 200);
    let sub_id = Uuid::new_v4().to_string();

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| crate::error::AppError(e.to_string()))?;

    let docker_bin = resolve_docker_bin();
    let env = env_with_docker_cli_in_path();

    let mut cmd = CommandBuilder::new(&docker_bin);
    cmd.args(["exec", "-it", &container_id, "/bin/sh"]);
    for (k, v) in &env {
        cmd.env(k, v);
    }

    let mut child = pair.slave.spawn_command(cmd).map_err(|e| crate::error::AppError(e.to_string()))?;
    let writer = pair.master.take_writer().map_err(|e| crate::error::AppError(e.to_string()))?;

    let session = PtySession {
        master: Arc::new(Mutex::new(pair.master)),
        writer: Arc::new(Mutex::new(writer)),
    };

    let sid = sub_id.clone();
    let app_handle = app.clone();
    let reader_master = session.master.clone();

    tokio::task::spawn_blocking(move || {
        let mut reader = {
            let master = reader_master.lock().unwrap();
            master.try_clone_reader().unwrap()
        };
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit("docker:exec-pty:data", PtyData {
                        subscription_id: sid.clone(),
                        data,
                    });
                }
            }
        }
        // PTY EOF 后等待进程真实退出码
        let exit_code = child.wait()
            .ok()
            .map(|s| s.exit_code() as i32)
            .unwrap_or(0);
        pty_sessions().remove(&sid);
        let _ = app_handle.emit("docker:exec-pty:exit", PtyExit {
            subscription_id: sid.clone(),
            exit_code,
        });
    });

    pty_sessions().insert(sub_id.clone(), session);
    Ok(PtyStartResult { subscription_id: sub_id })
}

#[tauri::command]
pub fn exec_pty_stop(subscription_id: String) -> Result<()> {
    pty_sessions().remove(&subscription_id);
    Ok(())
}

#[tauri::command]
pub fn exec_pty_write(subscription_id: String, data: String) -> Result<()> {
    pty_sessions()
        .with(&subscription_id, |s| {
            let mut writer = s.writer.lock().unwrap();
            use std::io::Write;
            writer.write_all(data.as_bytes()).map_err(|e| crate::error::AppError(e.to_string()))
        })
        .ok_or_else(|| crate::error::AppError("session not found".into()))??;
    Ok(())
}

#[tauri::command]
pub fn exec_pty_resize(subscription_id: String, cols: u16, rows: u16) -> Result<()> {
    let cols = cols.clamp(2, 400);
    let rows = rows.clamp(2, 200);
    pty_sessions()
        .with(&subscription_id, |s| {
            let master = s.master.lock().unwrap();
            master.resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
                .map_err(|e| crate::error::AppError(e.to_string()))
        })
        .ok_or_else(|| crate::error::AppError("session not found".into()))??;
    Ok(())
}
