//! Docker 事件流。每条事件序列化为 JSON 字符串，按 docker:events:chunk 推送 {subscriptionId, line}。
//! 对齐 ipcDocker.ts 的 events:start / events:stop（原版按行发送原始 JSON）。

use super::client::get_docker;
use crate::channels;
use crate::ipc::{into_ipc, IpcResult};
use bollard::system::EventsOptions;
use futures_util::stream::StreamExt;
use serde_json::json;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter};
use tokio::task::JoinHandle;
use uuid::Uuid;

static EVENT_SUBS: OnceLock<Mutex<HashMap<String, JoinHandle<()>>>> = OnceLock::new();

fn subs() -> &'static Mutex<HashMap<String, JoinHandle<()>>> {
    EVENT_SUBS.get_or_init(|| Mutex::new(HashMap::new()))
}

async fn start_inner(app: AppHandle, since_unix: Option<i64>) -> Result<serde_json::Value, String> {
    // bollard 未启用 chrono/time 特性时，since 为 Unix 时间戳字符串。
    let opts = EventsOptions::<String> {
        since: since_unix.map(|s| s.to_string()),
        until: None,
        filters: HashMap::new(),
    };

    let sub_id = Uuid::new_v4().to_string();
    let sid = sub_id.clone();
    let d = get_docker()?;
    let handle = tokio::spawn(async move {
        let mut stream = d.events(Some(opts));
        while let Some(item) = stream.next().await {
            match item {
                Ok(ev) => {
                    if let Ok(line) = serde_json::to_string(&ev) {
                        let _ = app.emit(
                            channels::EVENTS_CHUNK,
                            json!({ "subscriptionId": sid, "line": line }),
                        );
                    }
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
pub async fn docker_events_start(
    app: AppHandle,
    since_unix: Option<i64>,
) -> IpcResult<serde_json::Value> {
    into_ipc(start_inner(app, since_unix).await)
}

#[tauri::command]
pub async fn docker_events_stop(subscription_id: String) -> IpcResult<()> {
    if let Ok(mut m) = subs().lock() {
        if let Some(h) = m.remove(&subscription_id) {
            h.abort();
        }
    }
    IpcResult::ok(())
}

/// 应用退出时中止所有事件订阅。
pub fn abort_all() {
    if let Ok(mut m) = subs().lock() {
        for (_, h) in m.drain() {
            h.abort();
        }
    }
}
