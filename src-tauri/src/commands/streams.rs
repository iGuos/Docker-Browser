use crate::docker_client::get_docker;
use crate::error::Result;
use bollard::container::{LogOutput, LogsOptions};
use bollard::system::EventsOptions;
use futures_util::StreamExt;
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogsChunk {
    pub subscription_id: String,
    pub text: String,
    pub stream: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionResult {
    pub subscription_id: String,
}

static LOG_SUBS: std::sync::OnceLock<crate::stream_sub::StreamSubs> = std::sync::OnceLock::new();
static EVENT_SUBS: std::sync::OnceLock<crate::stream_sub::StreamSubs> = std::sync::OnceLock::new();

fn log_subs() -> &'static crate::stream_sub::StreamSubs {
    LOG_SUBS.get_or_init(crate::stream_sub::StreamSubs::new)
}
fn event_subs() -> &'static crate::stream_sub::StreamSubs {
    EVENT_SUBS.get_or_init(crate::stream_sub::StreamSubs::new)
}

#[tauri::command]
pub async fn logs_start(
    app: AppHandle,
    container_id: String,
    tail: Option<u64>,
    timestamps: Option<bool>,
) -> Result<SubscriptionResult> {
    let sub_id = Uuid::new_v4().to_string();
    let cancel_rx = log_subs().insert(sub_id.clone());

    let opts = LogsOptions::<String> {
        stdout: true,
        stderr: true,
        follow: true,
        tail: tail.map(|t| t.to_string()).unwrap_or_else(|| "100".to_string()),
        timestamps: timestamps.unwrap_or(false),
        ..Default::default()
    };

    let sid = sub_id.clone();
    tokio::spawn(async move {
        let mut stream = get_docker().logs(&container_id, Some(opts));
        tokio::pin!(cancel_rx);
        loop {
            tokio::select! {
                _ = &mut cancel_rx => break,
                item = stream.next() => {
                    match item {
                        Some(Ok(log)) => {
                            let (text, stream_name) = match log {
                                LogOutput::StdOut { message } => (String::from_utf8_lossy(&message).to_string(), "stdout"),
                                LogOutput::StdErr { message } => (String::from_utf8_lossy(&message).to_string(), "stderr"),
                                LogOutput::Console { message } => (String::from_utf8_lossy(&message).to_string(), "stdout"),
                                _ => continue,
                            };
                            let _ = app.emit("docker:logs:chunk", LogsChunk {
                                subscription_id: sid.clone(), text, stream: stream_name.to_string(),
                            });
                        }
                        _ => break,
                    }
                }
            }
        }
        log_subs().cancel(&sid);
    });

    Ok(SubscriptionResult { subscription_id: sub_id })
}

#[tauri::command]
pub async fn logs_stop(subscription_id: String) -> Result<()> {
    log_subs().cancel(&subscription_id);
    Ok(())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EventChunk {
    pub subscription_id: String,
    pub line: String,
}

#[tauri::command]
pub async fn events_start(app: AppHandle, since_unix: Option<i64>) -> Result<SubscriptionResult> {
    let sub_id = Uuid::new_v4().to_string();
    let cancel_rx = event_subs().insert(sub_id.clone());

    let opts = EventsOptions::<String> {
        since: since_unix.map(|s| s.to_string()),
        ..Default::default()
    };

    let sid = sub_id.clone();
    tokio::spawn(async move {
        let mut stream = get_docker().events(Some(opts));
        tokio::pin!(cancel_rx);
        loop {
            tokio::select! {
                _ = &mut cancel_rx => break,
                item = stream.next() => {
                    match item {
                        Some(Ok(evt)) => {
                            if let Ok(line) = serde_json::to_string(&evt) {
                                let _ = app.emit("docker:events:chunk", EventChunk {
                                    subscription_id: sid.clone(), line,
                                });
                            }
                        }
                        _ => break,
                    }
                }
            }
        }
        event_subs().cancel(&sid);
    });

    Ok(SubscriptionResult { subscription_id: sub_id })
}

#[tauri::command]
pub async fn events_stop(subscription_id: String) -> Result<()> {
    event_subs().cancel(&subscription_id);
    Ok(())
}
