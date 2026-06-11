//! 容器日志流。bollard 的 LogOutput 已自动处理多路复用/TTY 解复用，
//! 我们只需把每帧 message 转 UTF-8 文本，按事件 docker:logs:chunk 推送。
//! 对齐 ipcDocker.ts 的 logs:start / logs:stop。

use super::client::get_docker;
use crate::channels;
use crate::ipc::{into_ipc, IpcResult};
use bollard::container::{LogOutput, LogsOptions};
use futures_util::stream::StreamExt;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::task::JoinHandle;
use uuid::Uuid;

static LOG_SUBS: OnceLock<Mutex<HashMap<String, JoinHandle<()>>>> = OnceLock::new();

fn subs() -> &'static Mutex<HashMap<String, JoinHandle<()>>> {
    LOG_SUBS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn log_output_bytes(out: LogOutput) -> bytes::Bytes {
    match out {
        LogOutput::StdOut { message }
        | LogOutput::StdErr { message }
        | LogOutput::StdIn { message }
        | LogOutput::Console { message } => message,
    }
}

async fn start_inner(
    app: AppHandle,
    container_id: String,
    tail: Option<i64>,
    timestamps: Option<bool>,
) -> Result<serde_json::Value, String> {
    let container_id = container_id.trim().to_string();
    if container_id.is_empty() {
        return Err("invalid containerId".into());
    }
    let d = get_docker()?;
    // 轻量校验容器存在（对齐原版先 inspect 的早失败语义）
    d.inspect_container(&container_id, None)
        .await
        .map_err(|e| e.to_string())?;

    let opts = LogsOptions::<String> {
        follow: true,
        stdout: true,
        stderr: true,
        since: 0,
        until: 0,
        timestamps: timestamps.unwrap_or(true),
        tail: tail.unwrap_or(200).to_string(),
    };

    let sub_id = Uuid::new_v4().to_string();
    let sid = sub_id.clone();
    let handle = tokio::spawn(async move {
        let mut stream = d.logs(&container_id, Some(opts));
        while let Some(item) = stream.next().await {
            match item {
                Ok(out) => {
                    let bytes = log_output_bytes(out);
                    let text = String::from_utf8_lossy(&bytes).to_string();
                    let _ = app.emit(
                        channels::LOGS_CHUNK,
                        json!({ "subscriptionId": sid, "text": text }),
                    );
                }
                Err(_) => break,
            }
        }
        if let Ok(mut m) = subs().lock() {
            m.remove(&sid);
        }
    });
    subs()
        .lock()
        .map_err(|e| e.to_string())?
        .insert(sub_id.clone(), handle);
    Ok(json!({ "subscriptionId": sub_id }))
}

#[tauri::command]
pub async fn docker_logs_start(
    app: AppHandle,
    container_id: String,
    tail: Option<i64>,
    timestamps: Option<bool>,
) -> IpcResult<serde_json::Value> {
    into_ipc(start_inner(app, container_id, tail, timestamps).await)
}

#[tauri::command]
pub async fn docker_logs_stop(subscription_id: String) -> IpcResult<()> {
    if let Ok(mut m) = subs().lock() {
        if let Some(h) = m.remove(&subscription_id) {
            h.abort();
        }
    }
    IpcResult::ok(())
}

/// 应用退出时中止所有日志订阅。
pub fn abort_all() {
    if let Ok(mut m) = subs().lock() {
        for (_, h) in m.drain() {
            h.abort();
        }
    }
}
