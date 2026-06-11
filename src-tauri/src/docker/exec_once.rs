//! 一次性 exec（docker exec，非交互）：运行 sh -c <command>，收集输出与退出码。
//! 支持超时与全局取消（exec_cancel 同时杀掉所有 PTY 会话）。对齐 ipcDocker.ts exec-once / exec-cancel-current。

use super::client::get_docker;
use crate::ipc::{into_ipc, IpcResult};
use bollard::container::LogOutput;
use bollard::exec::{CreateExecOptions, StartExecResults};
use futures_util::stream::StreamExt;
use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use tokio::task::AbortHandle;

static EXEC_TASK: OnceLock<Mutex<Option<AbortHandle>>> = OnceLock::new();

fn slot() -> &'static Mutex<Option<AbortHandle>> {
    EXEC_TASK.get_or_init(|| Mutex::new(None))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecResult {
    output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    exit_code: Option<i64>,
}

async fn run_exec(
    container_id: String,
    command: String,
    timeout_sec: u64,
) -> Result<ExecResult, String> {
    let d = get_docker()?;
    let exec = d
        .create_exec(
            &container_id,
            CreateExecOptions {
                cmd: Some(vec!["sh".to_string(), "-c".to_string(), command]),
                attach_stdout: Some(true),
                attach_stderr: Some(true),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| e.to_string())?;

    let read_fut = async {
        let mut out = Vec::<u8>::new();
        if let StartExecResults::Attached { mut output, .. } = d
            .start_exec(&exec.id, None)
            .await
            .map_err(|e| e.to_string())?
        {
            while let Some(item) = output.next().await {
                match item {
                    Ok(LogOutput::StdOut { message })
                    | Ok(LogOutput::StdErr { message })
                    | Ok(LogOutput::StdIn { message })
                    | Ok(LogOutput::Console { message }) => out.extend_from_slice(&message),
                    Err(e) => return Err(e.to_string()),
                }
            }
        }
        Ok::<Vec<u8>, String>(out)
    };

    let out = if timeout_sec > 0 {
        match tokio::time::timeout(std::time::Duration::from_secs(timeout_sec), read_fut).await {
            Ok(r) => r?,
            Err(_) => return Err(format!("exec timeout after {timeout_sec}s")),
        }
    } else {
        read_fut.await?
    };

    let ins = d.inspect_exec(&exec.id).await.map_err(|e| e.to_string())?;
    Ok(ExecResult {
        output: String::from_utf8_lossy(&out).to_string(),
        exit_code: ins.exit_code,
    })
}

async fn exec_once_inner(
    container_id: String,
    command: String,
    timeout_sec: Option<u64>,
) -> Result<ExecResult, String> {
    let container_id = container_id.trim().to_string();
    let command = command.trim().to_string();
    if container_id.is_empty() {
        return Err("invalid containerId".into());
    }
    if command.is_empty() {
        return Err("command is required".into());
    }
    let timeout_sec = timeout_sec.map(|t| t.clamp(1, 600)).unwrap_or(0);

    // 放进可中止的任务，使 exec_cancel 能取消正在进行的 exec。
    let task = tokio::spawn(run_exec(container_id, command, timeout_sec));
    if let Ok(mut s) = slot().lock() {
        *s = Some(task.abort_handle());
    }
    let res = task.await;
    if let Ok(mut s) = slot().lock() {
        *s = None;
    }
    match res {
        Ok(inner) => inner,
        Err(_) => Err("cancelled".into()),
    }
}

#[tauri::command]
pub async fn docker_exec_once(
    container_id: String,
    command: String,
    timeout_sec: Option<u64>,
) -> IpcResult<ExecResult> {
    into_ipc(exec_once_inner(container_id, command, timeout_sec).await)
}

#[tauri::command]
pub async fn docker_exec_cancel() -> IpcResult<()> {
    if let Ok(mut s) = slot().lock() {
        if let Some(h) = s.take() {
            h.abort();
        }
    }
    super::exec_pty::kill_all_pty();
    IpcResult::ok(())
}
