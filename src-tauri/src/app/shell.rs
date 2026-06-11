//! 应用壳层杂项命令：Docker 运行时环境、主机指标、compose 版本、引擎 bootstrap/启停、打开路径/文档。
//! 对齐 electron/main/index.ts 的 app:* handler。

use crate::docker::cli_path::{extended_path, resolve_docker_bin};
use crate::docker::client::get_docker;
use crate::ipc::{into_ipc, IpcResult};
use serde::Serialize;
use serde_json::json;
use std::process::Stdio;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;

// ---- 运行时环境 ----

#[tauri::command]
pub fn app_docker_runtime_env() -> IpcResult<serde_json::Value> {
    IpcResult::ok(json!({
        "dockerHost": std::env::var("DOCKER_HOST").unwrap_or_default(),
        "dockerContext": std::env::var("DOCKER_CONTEXT").unwrap_or_default(),
    }))
}

// ---- 打开路径 / 文档（opener 插件）----

async fn open_path_inner(app: AppHandle, path: String) -> Result<(), String> {
    let p = path.trim();
    if p.is_empty() {
        return Err("path is required".into());
    }
    app.opener()
        .open_path(p.to_string(), None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn app_open_path(app: AppHandle, path: String) -> IpcResult<()> {
    into_ipc(open_path_inner(app, path).await)
}

#[tauri::command]
pub fn docker_open_docs(app: AppHandle) -> IpcResult<()> {
    let r = app
        .opener()
        .open_url("https://docs.docker.com/engine/api/latest/", None::<&str>)
        .map_err(|e| e.to_string());
    into_ipc(r)
}

// ---- 主机指标（sysinfo）----

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostMetrics {
    hostname: String,
    platform: String,
    arch: String,
    uptime_sec: u64,
    cpus: usize,
    cpu_model: String,
    cpu_usage_percent: i64,
    mem_total_bytes: u64,
    mem_free_bytes: u64,
    mem_used_percent: i64,
    loadavg: Option<[f64; 3]>,
}

/// node os.platform() 风格：darwin / win32 / linux …
fn node_platform() -> &'static str {
    match std::env::consts::OS {
        "macos" => "darwin",
        "windows" => "win32",
        other => other,
    }
}

async fn host_metrics_inner() -> Result<HostMetrics, String> {
    use sysinfo::System;
    let mut sys = System::new();
    // CPU 占用需两次采样
    sys.refresh_cpu_usage();
    tokio::time::sleep(Duration::from_millis(100)).await;
    sys.refresh_cpu_usage();
    let cpu_usage = sys.global_cpu_usage().round().clamp(0.0, 100.0) as i64;

    sys.refresh_memory();
    let total = sys.total_memory();
    let free = sys.free_memory();
    let used_pct = if total > 0 {
        (100.0 * (1.0 - free as f64 / total as f64)).round().clamp(0.0, 100.0) as i64
    } else {
        0
    };

    let cpus = sys.cpus();
    let cpu_model = cpus
        .first()
        .map(|c| c.brand().trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "—".into());
    let is_windows = std::env::consts::OS == "windows";
    let la = System::load_average();
    let loadavg = if is_windows {
        None
    } else {
        Some([la.one, la.five, la.fifteen])
    };

    Ok(HostMetrics {
        hostname: System::host_name().unwrap_or_default(),
        platform: node_platform().to_string(),
        arch: std::env::consts::ARCH.to_string(),
        uptime_sec: System::uptime(),
        cpus: cpus.len(),
        cpu_model,
        cpu_usage_percent: cpu_usage,
        mem_total_bytes: total,
        mem_free_bytes: free,
        mem_used_percent: used_pct,
        loadavg,
    })
}

#[tauri::command]
pub async fn app_host_metrics() -> IpcResult<HostMetrics> {
    into_ipc(host_metrics_inner().await)
}

// ---- docker CLI / compose / 引擎 ----

fn docker_command(program: &str) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(program);
    if let Some(p) = extended_path() {
        cmd.env("PATH", p);
    }
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    cmd
}

/// 带超时运行命令，返回 (success, stdout, stderr)。
async fn run_capture(mut cmd: tokio::process::Command, timeout: Duration) -> Option<(bool, String, String)> {
    let child = cmd.spawn().ok()?;
    let out = tokio::time::timeout(timeout, child.wait_with_output()).await.ok()?.ok()?;
    Some((
        out.status.success(),
        String::from_utf8_lossy(&out.stdout).to_string(),
        String::from_utf8_lossy(&out.stderr).to_string(),
    ))
}

async fn compose_version_inner() -> Result<String, String> {
    let mut cmd = docker_command(&resolve_docker_bin());
    cmd.args(["compose", "version"]);
    match run_capture(cmd, Duration::from_secs(12)).await {
        Some((true, stdout, _)) => Ok(if stdout.trim().is_empty() { "ok".into() } else { stdout.trim().to_string() }),
        Some((false, stdout, stderr)) => {
            let msg = if !stderr.trim().is_empty() { stderr.trim() } else { stdout.trim() };
            Err(if msg.is_empty() { "docker compose failed".into() } else { msg.to_string() })
        }
        None => Err("docker compose failed".into()),
    }
}

#[tauri::command]
pub async fn app_compose_version() -> IpcResult<String> {
    into_ipc(compose_version_inner().await)
}

async fn docker_cli_installed() -> bool {
    let mut cmd = docker_command(&resolve_docker_bin());
    cmd.args(["--version"]);
    matches!(run_capture(cmd, Duration::from_secs(6)).await, Some((true, _, _)))
}

async fn engine_reachable() -> bool {
    let fut = async {
        match get_docker() {
            Ok(d) => d.ping().await.is_ok(),
            Err(_) => false,
        }
    };
    matches!(tokio::time::timeout(Duration::from_secs(3), fut).await, Ok(true))
}

#[cfg(target_os = "windows")]
fn windows_docker_desktop_exe() -> Option<String> {
    for var in ["LOCALAPPDATA", "ProgramFiles"] {
        if let Ok(base) = std::env::var(var) {
            let p = std::path::Path::new(&base)
                .join("Docker")
                .join("Docker")
                .join("Docker Desktop.exe");
            if p.exists() {
                return Some(p.to_string_lossy().to_string());
            }
        }
    }
    None
}

fn can_start_engine() -> bool {
    #[cfg(target_os = "windows")]
    {
        windows_docker_desktop_exe().is_some()
    }
    #[cfg(target_os = "macos")]
    {
        true
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        false
    }
}

#[tauri::command]
pub async fn app_docker_bootstrap_status() -> IpcResult<serde_json::Value> {
    let installed = docker_cli_installed().await;
    let reachable = engine_reachable().await;
    IpcResult::ok(json!({
        "dockerInstalled": installed,
        "engineReachable": reachable,
        "canStartEngine": installed && !reachable && can_start_engine(),
    }))
}

#[tauri::command]
pub fn app_start_engine() -> IpcResult<()> {
    #[cfg(target_os = "macos")]
    {
        let r = std::process::Command::new("open").args(["-a", "Docker"]).spawn();
        return into_ipc(r.map(|_| ()).map_err(|e| e.to_string()));
    }
    #[cfg(target_os = "windows")]
    {
        match windows_docker_desktop_exe() {
            Some(exe) => {
                let r = std::process::Command::new(exe).spawn();
                into_ipc(r.map(|_| ()).map_err(|e| e.to_string()))
            }
            None => IpcResult::err("Docker Desktop not found"),
        }
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        IpcResult::err("Auto-start is not supported on this platform")
    }
}

#[tauri::command]
pub fn app_stop_engine() -> IpcResult<()> {
    #[cfg(target_os = "macos")]
    {
        let r = std::process::Command::new("osascript")
            .args(["-e", "tell application \"Docker\" to quit"])
            .spawn();
        return into_ipc(r.map(|_| ()).map_err(|e| e.to_string()));
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("docker").args(["desktop", "stop"]).spawn();
        IpcResult::ok(())
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        IpcResult::err("Stop action is not supported on this platform")
    }
}
