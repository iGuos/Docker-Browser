use crate::docker_client::get_docker;
use crate::error::Result;
use bollard::container::{
    Config, CreateContainerOptions, ListContainersOptions, RemoveContainerOptions,
    RestartContainerOptions, StartContainerOptions, StopContainerOptions,
    KillContainerOptions, InspectContainerOptions, StatsOptions,
};
use bollard::exec::{CreateExecOptions, StartExecResults};
use bollard::models::PortBinding;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

// ──────────────────────────── List / Inspect ────────────────────────────

#[tauri::command]
pub async fn list_containers(all: Option<bool>) -> Result<Vec<Value>> {
    let list = get_docker()
        .list_containers(Some(ListContainersOptions::<String> { all: all.unwrap_or(true), ..Default::default() }))
        .await?;
    Ok(list.into_iter().map(|c| serde_json::to_value(c).unwrap_or(Value::Null)).collect())
}

#[tauri::command]
pub async fn inspect_container(id: String) -> Result<Value> {
    let info = get_docker().inspect_container(&id, None::<InspectContainerOptions>).await?;
    Ok(serde_json::to_value(info).unwrap_or(Value::Null))
}

// ──────────────────────────── Lifecycle ────────────────────────────

#[tauri::command]
pub async fn start_container(id: String) -> Result<()> {
    get_docker().start_container(&id, None::<StartContainerOptions<String>>).await?;
    Ok(())
}

#[tauri::command]
pub async fn stop_container(id: String) -> Result<()> {
    get_docker().stop_container(&id, None::<StopContainerOptions>).await?;
    Ok(())
}

#[tauri::command]
pub async fn restart_container(id: String) -> Result<()> {
    get_docker().restart_container(&id, None::<RestartContainerOptions>).await?;
    Ok(())
}

#[tauri::command]
pub async fn kill_container(id: String) -> Result<()> {
    get_docker().kill_container(&id, None::<KillContainerOptions<String>>).await?;
    Ok(())
}

#[tauri::command]
pub async fn pause_container(id: String) -> Result<()> {
    get_docker().pause_container(&id).await?;
    Ok(())
}

#[tauri::command]
pub async fn unpause_container(id: String) -> Result<()> {
    get_docker().unpause_container(&id).await?;
    Ok(())
}

#[tauri::command]
pub async fn remove_container(id: String, force: Option<bool>, v: Option<bool>) -> Result<()> {
    get_docker()
        .remove_container(&id, Some(RemoveContainerOptions { force: force.unwrap_or(false), v: v.unwrap_or(false), ..Default::default() }))
        .await?;
    Ok(())
}

// ──────────────────────────── Create / Recreate ────────────────────────────

#[derive(Deserialize)]
pub struct CreateRunPayload {
    pub image: String,
    pub name: Option<String>,
    #[serde(rename = "envText")]
    pub env_text: Option<String>,
    #[serde(rename = "publishText")]
    pub publish_text: Option<String>,
    #[serde(rename = "cmdText")]
    pub cmd_text: Option<String>,
    #[serde(rename = "autoRemove")]
    pub auto_remove: Option<bool>,
    #[serde(rename = "restartPolicy")]
    pub restart_policy: Option<String>,
}

#[derive(Serialize)]
pub struct ContainerIdResult {
    pub id: String,
}

#[tauri::command]
pub async fn create_run_container(payload: CreateRunPayload) -> Result<ContainerIdResult> {
    let env: Option<Vec<String>> = payload.env_text.as_deref().map(parse_env_lines);
    let port_bindings = payload.publish_text.as_deref().map(parse_port_bindings).unwrap_or_default();
    let cmd: Option<Vec<String>> = payload.cmd_text.as_deref().filter(|s| !s.trim().is_empty()).map(shell_words);

    let exposed_ports = if port_bindings.is_empty() { None } else {
        Some(port_bindings.keys().map(|k| (k.clone(), HashMap::new())).collect::<HashMap<String, HashMap<(), ()>>>())
    };

    let host_config = bollard::models::HostConfig {
        auto_remove: payload.auto_remove,
        port_bindings: if port_bindings.is_empty() { None } else {
            Some(port_bindings.into_iter().map(|(k, v)| (k, Some(v))).collect())
        },
        restart_policy: payload.restart_policy.as_deref().map(restart_policy_to_bollard),
        ..Default::default()
    };

    let config = Config {
        image: Some(payload.image.clone()),
        env,
        cmd,
        exposed_ports,
        host_config: Some(host_config),
        ..Default::default()
    };

    let opts = payload.name.as_deref().map(|name| CreateContainerOptions { name, ..Default::default() });
    let resp = get_docker().create_container(opts, config).await?;
    get_docker().start_container(&resp.id, None::<StartContainerOptions<String>>).await?;
    Ok(ContainerIdResult { id: resp.id })
}

#[tauri::command]
pub async fn recreate_container(
    container_id: String,
    image: String,
    name: Option<String>,
    env_text: Option<String>,
    publish_text: Option<String>,
    cmd_text: Option<String>,
    auto_remove: Option<bool>,
    restart_policy: Option<String>,
) -> Result<ContainerIdResult> {
    let _ = get_docker().stop_container(&container_id, None::<StopContainerOptions>).await;
    get_docker().remove_container(&container_id, Some(RemoveContainerOptions { force: true, ..Default::default() })).await?;
    create_run_container(CreateRunPayload { image, name, env_text, publish_text, cmd_text, auto_remove, restart_policy }).await
}

#[derive(Deserialize)]
pub struct PatchRuntimePayload {
    #[serde(rename = "containerId")]
    pub container_id: String,
    pub name: Option<String>,
    #[serde(rename = "restartPolicy")]
    pub restart_policy: Option<String>,
    #[serde(rename = "memoryMb")]
    pub memory_mb: Option<i64>,
    pub cpus: Option<f64>,
    #[serde(rename = "pidsLimit")]
    pub pids_limit: Option<i64>,
}

#[tauri::command]
pub async fn patch_container_runtime(payload: PatchRuntimePayload) -> Result<()> {
    use bollard::container::{RenameContainerOptions, UpdateContainerOptions};

    // 容器重命名（若提供新名称）
    if let Some(ref new_name) = payload.name {
        let trimmed = new_name.trim();
        if !trimmed.is_empty() {
            get_docker()
                .rename_container(&payload.container_id, RenameContainerOptions { name: trimmed })
                .await?;
        }
    }

    // 运行时参数更新（内存/CPU/重启策略等）
    let has_runtime_update = payload.memory_mb.is_some()
        || payload.cpus.is_some()
        || payload.pids_limit.is_some()
        || payload.restart_policy.is_some();

    if has_runtime_update {
        let update = UpdateContainerOptions::<String> {
            memory: payload.memory_mb.map(|mb| mb * 1024 * 1024),
            nano_cpus: payload.cpus.map(|c| (c * 1e9) as i64),
            pids_limit: payload.pids_limit,
            restart_policy: payload.restart_policy.as_deref().map(restart_policy_to_bollard),
            ..Default::default()
        };
        get_docker().update_container(&payload.container_id, update).await?;
    }

    Ok(())
}

// ──────────────────────────── Exec (one-shot) ────────────────────────────

#[derive(Serialize)]
pub struct ExecResult {
    pub output: String,
    #[serde(rename = "exitCode")]
    pub exit_code: Option<i64>,
}

#[tauri::command]
pub async fn exec_once(
    container_id: String,
    command: String,
    timeout_sec: Option<u64>,
) -> Result<ExecResult> {
    let cmd: Vec<&str> = command.split_whitespace().collect();
    let exec = get_docker()
        .create_exec(&container_id, CreateExecOptions {
            cmd: Some(cmd),
            attach_stdout: Some(true),
            attach_stderr: Some(true),
            ..Default::default()
        })
        .await?;

    let output = match get_docker().start_exec(&exec.id, None).await? {
        StartExecResults::Attached { mut output, .. } => {
            let mut buf = String::new();
            let deadline = timeout_sec.map(|s| tokio::time::Instant::now() + tokio::time::Duration::from_secs(s));
            loop {
                let next = output.next();
                let chunk = if let Some(dl) = deadline {
                    match tokio::time::timeout_at(dl, next).await { Ok(Some(Ok(c))) => c, _ => break }
                } else {
                    match next.await { Some(Ok(c)) => c, _ => break }
                };
                use bollard::container::LogOutput;
                match chunk {
                    LogOutput::StdOut { message } | LogOutput::StdErr { message } => {
                        buf.push_str(&String::from_utf8_lossy(&message));
                    }
                    _ => {}
                }
            }
            buf
        }
        StartExecResults::Detached => String::new(),
    };

    let inspect = get_docker().inspect_exec(&exec.id).await?;
    Ok(ExecResult { output, exit_code: inspect.exit_code })
}

// ──────────────────────────── Stats ────────────────────────────

#[tauri::command]
pub async fn container_stats_once(container_id: String) -> Result<Value> {
    let stats = get_docker()
        .stats(&container_id, Some(StatsOptions { stream: false, ..Default::default() }))
        .next().await
        .ok_or_else(|| crate::error::AppError("no stats".into()))??;
    Ok(serde_json::to_value(stats).unwrap_or(Value::Null))
}

const STATS_BATCH: usize = 8;

#[tauri::command]
pub async fn containers_memory_usage(container_ids: Vec<String>) -> Result<HashMap<String, u64>> {
    let mut result = HashMap::new();
    for chunk in container_ids.chunks(STATS_BATCH) {
        let mut tasks = Vec::new();
        for id in chunk {
            let id = id.clone();
            tasks.push(async move {
                let stats = get_docker()
                    .stats(&id, Some(StatsOptions { stream: false, ..Default::default() }))
                    .next().await.and_then(|r| r.ok());
                (id, stats.as_ref().and_then(extract_memory_usage).unwrap_or(0))
            });
        }
        for t in tasks {
            let (id, usage) = t.await;
            result.insert(id, usage);
        }
    }
    Ok(result)
}

#[derive(Serialize)]
pub struct MemorySummary {
    pub total: u64,
    pub counted: u32,
    pub skipped: u32,
}

#[tauri::command]
pub async fn running_containers_memory_summary() -> Result<MemorySummary> {
    let list = get_docker()
        .list_containers(Some(ListContainersOptions::<String> { all: false, ..Default::default() }))
        .await?;
    let ids: Vec<String> = list.into_iter().filter_map(|c| c.id).collect();
    let mut total = 0u64; let mut counted = 0u32; let mut skipped = 0u32;
    for chunk in ids.chunks(STATS_BATCH) {
        for id in chunk {
            let id = id.clone();
            let usage = async move {
                get_docker()
                    .stats(&id, Some(StatsOptions { stream: false, ..Default::default() }))
                    .next().await.and_then(|r| r.ok()).as_ref().and_then(extract_memory_usage)
            }.await;
            match usage { Some(u) => { total += u; counted += 1; } None => skipped += 1 }
        }
    }
    Ok(MemorySummary { total, counted, skipped })
}

fn extract_memory_usage(stats: &bollard::container::Stats) -> Option<u64> {
    stats.memory_stats.usage.map(|u| u as u64)
}

// ──────────────────────────── Commit / Export ────────────────────────────

#[derive(Serialize)]
pub struct CommitResult {
    pub id: String,
}

#[tauri::command]
pub async fn commit_container(
    container_id: String,
    repo: String,
    tag: Option<String>,
    comment: Option<String>,
) -> Result<CommitResult> {
    use bollard::image::CommitContainerOptions;
    let opts = CommitContainerOptions {
        container: container_id.as_str(),
        repo: repo.as_str(),
        tag: tag.as_deref().unwrap_or(""),
        comment: comment.as_deref().unwrap_or(""),
        ..Default::default()
    };
    let resp = get_docker().commit_container(opts, Config::<String>::default()).await?;
    Ok(CommitResult { id: resp.id.unwrap_or_default() })
}

#[derive(Serialize)]
pub struct FilePathResult {
    #[serde(rename = "filePath")]
    pub file_path: String,
}

#[tauri::command]
pub async fn export_container_tar(app: tauri::AppHandle, container_id: String) -> Result<FilePathResult> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::io::AsyncWriteExt;

    let file_path = app.dialog().file()
        .set_title("Export Container")
        .set_file_name("container.tar")
        .blocking_save_file()
        .ok_or_else(|| crate::error::AppError("cancelled".into()))?;

    let path_str = file_path.into_path()
        .map_err(|_| crate::error::AppError("invalid path".into()))?
        .to_string_lossy().to_string();

    let mut stream = get_docker().export_container(&container_id);
    let mut file = tokio::fs::File::create(&path_str).await?;
    while let Some(chunk) = stream.next().await { file.write_all(&chunk?).await?; }
    Ok(FilePathResult { file_path: path_str })
}

// ──────────────────────────── Helpers ────────────────────────────

fn parse_env_lines(text: &str) -> Vec<String> {
    text.lines().map(|l| l.trim()).filter(|l| !l.is_empty() && !l.starts_with('#')).map(|l| l.to_string()).collect()
}

fn parse_port_bindings(text: &str) -> HashMap<String, Vec<PortBinding>> {
    let mut map: HashMap<String, Vec<PortBinding>> = HashMap::new();
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() { continue; }
        let (spec, proto) = if let Some((s, p)) = line.rsplit_once('/') { (s, p) } else { (line, "tcp") };
        let parts: Vec<&str> = spec.splitn(3, ':').collect();
        let (host_ip, host_port, container_port) = match parts.as_slice() {
            [h, c] => ("", *h, *c),
            [ip, h, c] => (*ip, *h, *c),
            _ => continue,
        };
        let container_key = format!("{container_port}/{proto}");
        map.entry(container_key).or_default().push(PortBinding {
            host_ip: if host_ip.is_empty() { None } else { Some(host_ip.to_string()) },
            host_port: Some(host_port.to_string()),
        });
    }
    map
}

fn shell_words(s: &str) -> Vec<String> {
    s.split_whitespace().map(|w| w.to_string()).collect()
}

fn restart_policy_to_bollard(policy: &str) -> bollard::models::RestartPolicy {
    use bollard::models::{RestartPolicy, RestartPolicyNameEnum};
    let name = match policy {
        "always" => RestartPolicyNameEnum::ALWAYS,
        "unless-stopped" => RestartPolicyNameEnum::UNLESS_STOPPED,
        "on-failure" => RestartPolicyNameEnum::ON_FAILURE,
        _ => RestartPolicyNameEnum::NO,
    };
    RestartPolicy { name: Some(name), maximum_retry_count: None }
}
