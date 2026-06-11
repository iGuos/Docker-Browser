//! docker CLI 编排：docker run（整行 shell）、docker build（Dockerfile）、docker compose up。
//! 进度按 docker:docker-cli-progress 推送 {requestId, text}。对齐 dockerCliCreate.ts。

use super::cli_path::{extended_path, resolve_docker_bin};
use crate::channels;
use crate::ipc::{into_ipc, IpcResult};
use std::process::Stdio;
use tauri::{AppHandle, Emitter};
use tokio::io::AsyncReadExt;
use tokio::process::Command;
use uuid::Uuid;

const CLI_LOG_MAX: usize = 16000;

fn emit_progress(app: &AppHandle, request_id: &Option<String>, text: &str) {
    let Some(rid) = request_id else { return };
    if text.is_empty() {
        return;
    }
    let out = if text.len() > CLI_LOG_MAX {
        format!("{}…\n", &text[..CLI_LOG_MAX])
    } else {
        text.to_string()
    };
    let _ = app.emit(channels::CLI_PROGRESS, serde_json::json!({ "requestId": rid, "text": out }));
}

fn base_command(program: &str) -> Command {
    let mut cmd = Command::new(program);
    if let Some(p) = extended_path() {
        cmd.env("PATH", p);
    }
    cmd
}

/// 运行 docker argv 并捕获 stdout（无进度流）。供 commit 等一次性命令复用。
pub async fn run_docker_capture(argv: &[String]) -> Result<String, String> {
    let mut cmd = base_command(&resolve_docker_bin());
    cmd.args(argv);
    let out = cmd.output().await.map_err(|e| e.to_string())?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        let err = String::from_utf8_lossy(&out.stderr);
        Err(if err.trim().is_empty() {
            format!("docker exited with code {:?}", out.status.code())
        } else {
            err.trim().to_string()
        })
    }
}

/// spawn 子进程，流式转发 stdout/stderr 到进度，返回 trim 后的 stdout；非零退出报错。
async fn spawn_stream(
    mut cmd: Command,
    app: &AppHandle,
    request_id: &Option<String>,
) -> Result<String, String> {
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let mut stdout = child.stdout.take().ok_or("no stdout")?;
    let mut stderr = child.stderr.take().ok_or("no stderr")?;

    let app_o = app.clone();
    let rid_o = request_id.clone();
    let out_task = tokio::spawn(async move {
        let mut acc = String::new();
        let mut buf = [0u8; 8192];
        loop {
            match stdout.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let t = String::from_utf8_lossy(&buf[..n]).to_string();
                    acc.push_str(&t);
                    emit_progress(&app_o, &rid_o, &t);
                }
            }
        }
        acc
    });

    let app_e = app.clone();
    let rid_e = request_id.clone();
    let err_task = tokio::spawn(async move {
        let mut acc = String::new();
        let mut buf = [0u8; 8192];
        loop {
            match stderr.read(&mut buf).await {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let t = String::from_utf8_lossy(&buf[..n]).to_string();
                    acc.push_str(&t);
                    emit_progress(&app_e, &rid_e, &t);
                }
            }
        }
        acc
    });

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let stdout_acc = out_task.await.unwrap_or_default();
    let stderr_acc = err_task.await.unwrap_or_default();
    if status.success() {
        Ok(stdout_acc.trim().to_string())
    } else {
        let err = stderr_acc.trim();
        Err(if err.is_empty() {
            format!("process exited with code {:?}", status.code())
        } else {
            err.to_string()
        })
    }
}

/// 折叠换行与续行
fn normalize_cli_input(raw: &str) -> String {
    raw.replace("\\\r\n", " ")
        .replace("\\\n", " ")
        .replace(['\r', '\n'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_run_container_name(normalized: &str) -> Option<String> {
    let tokens: Vec<&str> = normalized.split(' ').collect();
    for (i, tok) in tokens.iter().enumerate() {
        if let Some(rest) = tok.strip_prefix("--name=") {
            return Some(rest.to_string());
        }
        if *tok == "--name" {
            if let Some(next) = tokens.get(i + 1) {
                return Some(next.to_string());
            }
        }
    }
    None
}

fn is_detached_run(normalized: &str) -> bool {
    let lower = normalized.to_lowercase();
    let Some(rest) = lower.strip_prefix("docker run ") else {
        return false;
    };
    for tok in rest.split_whitespace() {
        if !tok.starts_with('-') || tok == "--" {
            break;
        }
        if tok == "--detach" {
            return true;
        }
        if !tok.starts_with("--") && tok[1..].contains('d') {
            return true;
        }
    }
    false
}

fn parse_container_id_from_stdout(out: &str) -> Option<String> {
    for line in out.lines().rev() {
        let l = line.trim();
        if !l.is_empty()
            && l.len() >= 12
            && l.len() <= 64
            && l.chars().all(|c| c.is_ascii_hexdigit())
        {
            return Some(l.to_string());
        }
    }
    None
}

async fn assert_container_running(
    name_or_id: &str,
    app: &AppHandle,
    request_id: &Option<String>,
) -> Result<(), String> {
    emit_progress(
        app,
        request_id,
        &format!("\n$ docker inspect (wait until running) {name_or_id}\n"),
    );
    for _ in 0..80 {
        let mut cmd = base_command(&resolve_docker_bin());
        cmd.args(["inspect", "-f", "{{.State.Running}}", name_or_id]);
        if let Ok(out) = cmd.output().await {
            if String::from_utf8_lossy(&out.stdout).trim().eq_ignore_ascii_case("true") {
                emit_progress(app, request_id, "State.Running=true OK\n");
                return Ok(());
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    }
    Err("Container did not reach running state (inspect timeout).".into())
}

/// 工作目录：cwd/docker-browser/cli-workdir，失败则退回 cwd。
fn cli_workdir() -> std::path::PathBuf {
    let base = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    let dir = base.join("docker-browser").join("cli-workdir");
    if std::fs::create_dir_all(&dir).is_ok() {
        dir
    } else {
        base
    }
}

fn unique_tmpdir(prefix: &str) -> std::io::Result<std::path::PathBuf> {
    let dir = std::env::temp_dir().join(format!("{prefix}{}", Uuid::new_v4()));
    std::fs::create_dir_all(&dir)?;
    Ok(dir)
}

// ---- 命令 ----

async fn create_from_cli_inner(
    app: AppHandle,
    line: String,
    request_id: Option<String>,
) -> Result<(), String> {
    let normalized = normalize_cli_input(&line);
    if normalized.is_empty() {
        return Err("Command is empty.".into());
    }
    if !normalized.to_lowercase().starts_with("docker run ")
        && normalized.to_lowercase() != "docker run"
    {
        return Err("Command must start with docker run.".into());
    }
    let name = parse_run_container_name(&normalized);
    emit_progress(&app, &request_id, &format!("$ {normalized}\n\n"));

    let cwd = cli_workdir();
    #[cfg(windows)]
    let mut cmd = {
        let mut c = base_command("cmd");
        c.arg("/C").arg(&normalized);
        c
    };
    #[cfg(not(windows))]
    let mut cmd = {
        let mut c = base_command("sh");
        c.arg("-c").arg(&normalized);
        c
    };
    cmd.current_dir(&cwd);
    let run_out = spawn_stream(cmd, &app, &request_id).await?;

    if is_detached_run(&normalized) {
        let reference = name.or_else(|| parse_container_id_from_stdout(&run_out));
        let Some(reference) = reference else {
            return Err("Detached docker run finished but cannot verify: add --name <name> or ensure the engine prints the container ID on stdout.".into());
        };
        assert_container_running(&reference, &app, &request_id).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn docker_create_from_cli(
    app: AppHandle,
    line: String,
    request_id: Option<String>,
) -> IpcResult<()> {
    into_ipc(create_from_cli_inner(app, line, request_id).await)
}

fn assert_safe_image_tag(raw: &str) -> Result<String, String> {
    let t = raw.trim();
    if t.is_empty() {
        return Err("Image tag is required.".into());
    }
    if t.len() > 200 {
        return Err("Image tag is too long.".into());
    }
    // 允许 字母数字 . _ - / 以及可选 :tag
    let valid = t.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/' | ':'));
    if !valid {
        return Err("Invalid image tag. Use letters, digits, ._-/ and optional :tag.".into());
    }
    Ok(t.to_string())
}

fn container_name_from_image_tag(tag: &str) -> String {
    let base = tag.rsplit('/').next().unwrap_or("app");
    let no_colon = base.split(':').next().unwrap_or(base);
    let mut n: String = no_colon
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-') { c } else { '-' })
        .collect();
    if n.is_empty() {
        n = "app".into();
    }
    if !n.chars().next().map(|c| c.is_ascii_alphanumeric()).unwrap_or(false) {
        n = format!("a{n}");
    }
    n.chars().take(120).collect()
}

async fn build_dockerfile_inner(
    app: AppHandle,
    dockerfile: String,
    image_tag: String,
    request_id: Option<String>,
) -> Result<(), String> {
    let tag = assert_safe_image_tag(&image_tag)?;
    let df = dockerfile.trim();
    if df.is_empty() {
        return Err("Dockerfile is empty.".into());
    }
    let tmp = unique_tmpdir("dbrowser-df-").map_err(|e| e.to_string())?;
    let result = async {
        std::fs::write(tmp.join("Dockerfile"), df).map_err(|e| e.to_string())?;
        emit_progress(&app, &request_id, &format!("$ docker build -t {tag} .\n(workdir: temp)\n\n"));
        let mut cmd = base_command(&resolve_docker_bin());
        cmd.args(["build", "-t", &tag, "."]).current_dir(&tmp);
        spawn_stream(cmd, &app, &request_id).await?;
        emit_progress(&app, &request_id, "\n");
        Ok::<(), String>(())
    }
    .await;
    let _ = std::fs::remove_dir_all(&tmp);
    result?;

    let cname = container_name_from_image_tag(&tag);
    emit_progress(&app, &request_id, &format!("$ docker run -d --name {cname} {tag}\n\n"));
    let mut cmd = base_command(&resolve_docker_bin());
    cmd.args(["run", "-d", "--name", &cname, &tag]);
    spawn_stream(cmd, &app, &request_id).await?;
    assert_container_running(&cname, &app, &request_id).await
}

#[tauri::command]
pub async fn docker_build_dockerfile(
    app: AppHandle,
    dockerfile: String,
    image_tag: String,
    request_id: Option<String>,
) -> IpcResult<()> {
    into_ipc(build_dockerfile_inner(app, dockerfile, image_tag, request_id).await)
}

fn normalize_compose_project_name(raw: &Option<String>) -> Result<Option<String>, String> {
    let t = raw.as_deref().unwrap_or("").trim();
    if t.is_empty() {
        return Ok(None);
    }
    if t.len() > 200 {
        return Err("Project name is too long.".into());
    }
    let mut chars = t.chars();
    let first_ok = chars.next().map(|c| c.is_ascii_alphanumeric()).unwrap_or(false);
    let rest_ok = t.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-'));
    if !first_ok || !rest_ok {
        return Err("Invalid project name. Use letters, digits, ._- and start with a letter or digit.".into());
    }
    Ok(Some(t.to_string()))
}

async fn compose_up_inner(
    app: AppHandle,
    compose_yaml: String,
    project_name: Option<String>,
    request_id: Option<String>,
) -> Result<(), String> {
    let yml = compose_yaml.trim();
    if yml.is_empty() {
        return Err("Compose file is empty.".into());
    }
    let project = normalize_compose_project_name(&project_name)?;
    let tmp = unique_tmpdir("dbrowser-compose-").map_err(|e| e.to_string())?;
    let result = async {
        std::fs::write(tmp.join("compose.yaml"), yml).map_err(|e| e.to_string())?;
        let mut argv: Vec<&str> = vec!["compose"];
        if let Some(p) = project.as_deref() {
            argv.push("-p");
            argv.push(p);
        }
        argv.extend(["-f", "compose.yaml", "up", "-d"]);
        emit_progress(&app, &request_id, &format!("$ docker {}\n(workdir: temp)\n\n", argv.join(" ")));
        let mut cmd = base_command(&resolve_docker_bin());
        cmd.args(&argv).current_dir(&tmp);
        spawn_stream(cmd, &app, &request_id).await?;
        emit_progress(&app, &request_id, "\n");
        Ok::<(), String>(())
    }
    .await;
    let _ = std::fs::remove_dir_all(&tmp);
    result
}

#[tauri::command]
pub async fn docker_compose_up(
    app: AppHandle,
    compose_yaml: String,
    project_name: Option<String>,
    request_id: Option<String>,
) -> IpcResult<()> {
    into_ipc(compose_up_inner(app, compose_yaml, project_name, request_id).await)
}
