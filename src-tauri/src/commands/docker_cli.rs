use crate::docker_path::{env_with_docker_cli_in_path, resolve_docker_bin};
use crate::error::Result;
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[tauri::command]
pub async fn create_and_restart_from_docker_run_cli(
    app: AppHandle,
    line: String,
    request_id: Option<String>,
) -> Result<()> {
    let line = line.trim().to_string();
    if !line.starts_with("docker run") {
        return Err(crate::error::AppError("Command must start with 'docker run'".into()));
    }
    run_docker_command_streaming(&app, &line, request_id.as_deref(), None).await
}

#[tauri::command]
pub async fn build_and_run_from_dockerfile(
    app: AppHandle,
    dockerfile: String,
    image_tag: String,
    request_id: Option<String>,
) -> Result<()> {
    let tmp_dir = tempfile::tempdir().map_err(|e| crate::error::AppError(e.to_string()))?;
    tokio::fs::write(tmp_dir.path().join("Dockerfile"), &dockerfile).await?;

    let build_cmd = format!("docker build -t {} .", shell_escape(&image_tag));
    run_docker_command_streaming(&app, &build_cmd, request_id.as_deref(), Some(tmp_dir.path())).await?;

    let container_name = image_tag.replace(['/', ':'], "-");
    let run_cmd = format!("docker run -d --name {} {}", shell_escape(&container_name), shell_escape(&image_tag));
    run_docker_command_streaming(&app, &run_cmd, request_id.as_deref(), None).await
}

#[tauri::command]
pub async fn compose_up_from_yaml(
    app: AppHandle,
    compose_yaml: String,
    project_name: Option<String>,
    request_id: Option<String>,
) -> Result<()> {
    let tmp_dir = tempfile::tempdir().map_err(|e| crate::error::AppError(e.to_string()))?;
    tokio::fs::write(tmp_dir.path().join("docker-compose.yml"), &compose_yaml).await?;

    let project_flag = project_name
        .as_deref()
        .map(|p| format!("-p {} ", shell_escape(p)))
        .unwrap_or_default();
    let cmd = format!("docker compose {project_flag}up -d");
    run_docker_command_streaming(&app, &cmd, request_id.as_deref(), Some(tmp_dir.path())).await
}

async fn run_docker_command_streaming(
    app: &AppHandle,
    cmd_line: &str,
    request_id: Option<&str>,
    cwd: Option<&std::path::Path>,
) -> Result<()> {
    let docker_bin = resolve_docker_bin();
    let env = env_with_docker_cli_in_path();

    let mut parts = shlex_split(cmd_line)
        .ok_or_else(|| crate::error::AppError("failed to parse command".into()))?;
    if parts.first().map(|s| s == "docker").unwrap_or(false) {
        parts[0] = docker_bin;
    }

    let (program, args) = parts.split_first()
        .ok_or_else(|| crate::error::AppError("empty command".into()))?;

    let mut child = Command::new(program)
        .args(args)
        .envs(&env)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .current_dir(cwd.unwrap_or_else(|| std::path::Path::new("/")))
        .spawn()
        .map_err(|e| crate::error::AppError(e.to_string()))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let rid = request_id.map(|s| s.to_string());

    let stdout_task = tokio::spawn({
        let app = app.clone(); let rid = rid.clone();
        async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await { emit_progress(&app, rid.as_deref(), &line); }
        }
    });
    let stderr_task = tokio::spawn({
        let app = app.clone(); let rid = rid.clone();
        async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await { emit_progress(&app, rid.as_deref(), &line); }
        }
    });

    let status = child.wait().await.map_err(|e| crate::error::AppError(e.to_string()))?;
    let _ = tokio::join!(stdout_task, stderr_task);

    if !status.success() {
        return Err(crate::error::AppError(format!("Command exited with code {}", status.code().unwrap_or(-1))));
    }
    Ok(())
}

fn emit_progress(app: &AppHandle, request_id: Option<&str>, text: &str) {
    let _ = app.emit("docker:docker-cli-progress", serde_json::json!({
        "requestId": request_id.unwrap_or(""),
        "text": text,
    }));
}

fn shlex_split(s: &str) -> Option<Vec<String>> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut in_quote: Option<char> = None;
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match (c, in_quote) {
            ('\'', None) => in_quote = Some('\''),
            ('"', None) => in_quote = Some('"'),
            ('\'', Some('\'')) | ('"', Some('"')) => in_quote = None,
            ('\\', None) => { if let Some(nc) = chars.next() { current.push(nc); } }
            (' ' | '\t', None) => { if !current.is_empty() { result.push(current.clone()); current.clear(); } }
            _ => current.push(c),
        }
    }
    if in_quote.is_some() { return None; }
    if !current.is_empty() { result.push(current); }
    Some(result)
}

fn shell_escape(s: &str) -> String {
    if s.chars().all(|c| c.is_alphanumeric() || c == '-' || c == '_' || c == '.') {
        s.to_string()
    } else {
        format!("'{}'", s.replace('\'', "'\\''"))
    }
}
