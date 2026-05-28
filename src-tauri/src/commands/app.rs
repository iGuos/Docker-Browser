use crate::docker_path::resolve_docker_bin;
use crate::error::Result;
use serde::Serialize;
use std::process::Command;
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppVersion {
    pub version: String,
    pub is_packaged: bool,
}

#[tauri::command]
pub fn get_app_version(app: AppHandle) -> Result<AppVersion> {
    let version = app.package_info().version.to_string();
    let is_packaged = !cfg!(debug_assertions);
    Ok(AppVersion { version, is_packaged })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerRuntimeEnv {
    pub docker_host: String,
    pub docker_context: String,
}

#[tauri::command]
pub fn get_docker_runtime_env() -> Result<DockerRuntimeEnv> {
    Ok(DockerRuntimeEnv {
        docker_host: std::env::var("DOCKER_HOST").unwrap_or_default(),
        docker_context: std::env::var("DOCKER_CONTEXT").unwrap_or_default(),
    })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DockerBootstrapStatus {
    pub docker_installed: bool,
    pub engine_reachable: bool,
    pub can_start_engine: bool,
}

#[tauri::command]
pub async fn get_docker_bootstrap_status() -> Result<DockerBootstrapStatus> {
    let docker_bin = resolve_docker_bin();
    let docker_installed = std::path::Path::new(&docker_bin).exists()
        || which_docker().is_some();

    let engine_reachable = crate::docker_client::get_docker()
        .ping()
        .await
        .is_ok();

    let can_start_engine = can_start_docker_engine();

    Ok(DockerBootstrapStatus {
        docker_installed,
        engine_reachable,
        can_start_engine,
    })
}

fn which_docker() -> Option<String> {
    let output = Command::new("which").arg("docker").output().ok()?;
    if output.status.success() {
        String::from_utf8(output.stdout).ok().map(|s| s.trim().to_string())
    } else {
        None
    }
}

fn can_start_docker_engine() -> bool {
    #[cfg(target_os = "macos")]
    {
        std::path::Path::new("/Applications/Docker.app").exists()
    }
    #[cfg(target_os = "linux")]
    {
        // Check if systemctl can start docker
        Command::new("systemctl")
            .args(["is-enabled", "docker"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false)
    }
    #[cfg(target_os = "windows")]
    {
        false
    }
}

#[tauri::command]
pub async fn start_docker_engine() -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-a")
            .arg("Docker")
            .spawn()
            .map_err(|e| crate::error::AppError(e.to_string()))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("systemctl")
            .args(["start", "docker"])
            .spawn()
            .map_err(|e| crate::error::AppError(e.to_string()))?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        Err(crate::error::AppError("Not supported on Windows".to_string()))
    }
}

#[tauri::command]
pub async fn stop_docker_engine() -> Result<()> {
    #[cfg(target_os = "macos")]
    {
        Command::new("osascript")
            .args(["-e", "quit app \"Docker\""])
            .spawn()
            .map_err(|e| crate::error::AppError(e.to_string()))?;
        Ok(())
    }
    #[cfg(target_os = "linux")]
    {
        Command::new("systemctl")
            .args(["stop", "docker"])
            .spawn()
            .map_err(|e| crate::error::AppError(e.to_string()))?;
        Ok(())
    }
    #[cfg(target_os = "windows")]
    {
        Err(crate::error::AppError("Not supported on Windows".to_string()))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostMetrics {
    pub hostname: String,
    pub total_mem_bytes: u64,
    pub used_mem_percent: u32,
    pub cpu_count: u32,
    pub cpu_usage_percent: u32,
    pub loadavg: Option<[f64; 3]>,
    pub platform: String,
    pub arch: String,
}

#[tauri::command]
pub async fn get_host_metrics() -> Result<HostMetrics> {
    use sysinfo::{CpuRefreshKind, MemoryRefreshKind, RefreshKind, System};

    let mut sys = System::new_with_specifics(
        RefreshKind::nothing()
            .with_memory(MemoryRefreshKind::everything())
            .with_cpu(CpuRefreshKind::everything()),
    );
    // Second sample for CPU usage
    tokio::time::sleep(tokio::time::Duration::from_millis(100)).await;
    sys.refresh_cpu_usage();

    let total = sys.total_memory();
    let used = sys.used_memory();
    let used_pct = if total > 0 {
        ((used as f64 / total as f64) * 100.0) as u32
    } else {
        0
    };
    let cpu_pct = sys
        .cpus()
        .iter()
        .map(|c| c.cpu_usage())
        .sum::<f32>()
        / sys.cpus().len() as f32;

    #[cfg(unix)]
    let loadavg = {
        let la = System::load_average();
        Some([la.one, la.five, la.fifteen])
    };
    #[cfg(not(unix))]
    let loadavg = None;

    Ok(HostMetrics {
        hostname: System::host_name().unwrap_or_default(),
        total_mem_bytes: total,
        used_mem_percent: used_pct,
        cpu_count: sys.cpus().len() as u32,
        cpu_usage_percent: cpu_pct as u32,
        loadavg,
        platform: std::env::consts::OS.to_string(),
        arch: std::env::consts::ARCH.to_string(),
    })
}

#[tauri::command]
pub async fn get_compose_version() -> Result<String> {
    use crate::docker_path::env_with_docker_cli_in_path;

    let docker_bin = resolve_docker_bin();
    let output = Command::new(&docker_bin)
        .args(["compose", "version", "--short"])
        .envs(env_with_docker_cli_in_path())
        .output()
        .map_err(|e| crate::error::AppError(e.to_string()))?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(crate::error::AppError(
            String::from_utf8_lossy(&output.stderr).to_string(),
        ))
    }
}

#[tauri::command]
pub async fn open_path(path: String) -> Result<()> {
    #[cfg(target_os = "macos")]
    Command::new("open").arg(&path).spawn()?;
    #[cfg(target_os = "linux")]
    Command::new("xdg-open").arg(&path).spawn()?;
    #[cfg(target_os = "windows")]
    Command::new("explorer").arg(&path).spawn()?;
    Ok(())
}
