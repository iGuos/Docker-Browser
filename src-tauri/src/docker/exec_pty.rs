//! 交互式终端：portable-pty spawn `docker exec -it <id> /bin/sh`，读线程把输出按
//! docker:exec-pty-data 推送，退出时按 docker:exec-pty-exit 推送。对齐 dockerExecPty.ts。

use crate::channels;
use crate::ipc::IpcResult;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde_json::json;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

static SESSIONS: OnceLock<Mutex<HashMap<String, PtySession>>> = OnceLock::new();

fn sessions() -> &'static Mutex<HashMap<String, PtySession>> {
    SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn clamp_cols(c: Option<i64>) -> u16 {
    c.filter(|v| v.is_positive())
        .map(|v| v.clamp(2, 400) as u16)
        .unwrap_or(80)
}
fn clamp_rows(r: Option<i64>) -> u16 {
    r.filter(|v| v.is_positive())
        .map(|v| v.clamp(2, 200) as u16)
        .unwrap_or(24)
}

fn home_dir() -> String {
    std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_else(|_| "/".to_string())
}

fn start_inner(
    app: AppHandle,
    container_id: String,
    cols: Option<i64>,
    rows: Option<i64>,
) -> Result<serde_json::Value, String> {
    let container_id = container_id.trim().to_string();
    if container_id.is_empty() {
        return Err("invalid containerId".into());
    }
    let cols = clamp_cols(cols);
    let rows = clamp_rows(rows);

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(super::cli_path::resolve_docker_bin());
    cmd.args(["exec", "-it", &container_id, "/bin/sh"]);
    cmd.cwd(home_dir());
    cmd.env("TERM", "xterm-256color");
    if let Some(p) = super::cli_path::extended_path() {
        cmd.env("PATH", p);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    // 释放 slave，使子进程退出后 master 能收到 EOF
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    let subscription_id = Uuid::new_v4().to_string();
    sessions().lock().map_err(|e| e.to_string())?.insert(
        subscription_id.clone(),
        PtySession {
            master: pair.master,
            writer,
            child,
        },
    );

    // 阻塞读线程：portable-pty 的 reader 是同步 IO。
    let sid = subscription_id.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app.emit(
                        channels::EXEC_PTY_DATA,
                        json!({ "subscriptionId": sid, "data": data }),
                    );
                }
                Err(_) => break,
            }
        }
        // 仅当本线程负责移除（自然退出）时才发 exit；若已被 stop/kill 移除则静默（对齐原 had 检查）。
        let owned = sessions().lock().ok().and_then(|mut m| m.remove(&sid));
        if let Some(mut sess) = owned {
            let exit_code = sess.child.wait().map(|s| s.exit_code() as i64).unwrap_or(0);
            let _ = app.emit(
                channels::EXEC_PTY_EXIT,
                json!({ "subscriptionId": sid, "exitCode": exit_code }),
            );
        }
    });

    Ok(json!({ "subscriptionId": subscription_id }))
}

#[tauri::command]
pub fn docker_exec_pty_start(
    app: AppHandle,
    container_id: String,
    cols: Option<i64>,
    rows: Option<i64>,
) -> IpcResult<serde_json::Value> {
    crate::ipc::into_ipc(start_inner(app, container_id, cols, rows))
}

#[tauri::command]
pub fn docker_exec_pty_stop(subscription_id: String) -> IpcResult<()> {
    let owned = sessions().lock().ok().and_then(|mut m| m.remove(&subscription_id));
    if let Some(mut sess) = owned {
        let _ = sess.child.kill();
    }
    IpcResult::ok(())
}

#[tauri::command]
pub fn docker_exec_pty_write(subscription_id: String, data: String) -> IpcResult<()> {
    let mut guard = match sessions().lock() {
        Ok(g) => g,
        Err(e) => return IpcResult::err(e.to_string()),
    };
    match guard.get_mut(&subscription_id) {
        Some(sess) => match sess.writer.write_all(data.as_bytes()).and_then(|_| sess.writer.flush()) {
            Ok(_) => IpcResult::ok(()),
            Err(e) => IpcResult::err(e.to_string()),
        },
        None => IpcResult::err("session not found"),
    }
}

#[tauri::command]
pub fn docker_exec_pty_resize(
    subscription_id: String,
    cols: Option<i64>,
    rows: Option<i64>,
) -> IpcResult<()> {
    let cols = clamp_cols(cols);
    let rows = clamp_rows(rows);
    if let Ok(guard) = sessions().lock() {
        if let Some(sess) = guard.get(&subscription_id) {
            let _ = sess.master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
        }
    }
    IpcResult::ok(())
}

/// 应用退出或全局中断时，静默杀掉所有 PTY 会话（不发 exit）。
pub fn kill_all_pty() {
    if let Ok(mut m) = sessions().lock() {
        for (_, mut sess) in m.drain() {
            let _ = sess.child.kill();
        }
    }
}
