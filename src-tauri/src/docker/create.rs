//! 创建 / 重建 / 运行时调参 / 提交。对齐 ipcDocker.ts 与 dockerCreateHelpers / dockerRecreateHelpers。
//! commit 走 docker CLI（bollard 的 Commit 模型 id 字段名与引擎返回不符，拿不到镜像 id）。

use super::cli;
use super::client::get_docker;
use crate::ipc::{into_ipc, IpcResult};
use bollard::container::{
    Config, CreateContainerOptions, RenameContainerOptions, UpdateContainerOptions,
};
use serde::Deserialize;
use serde_json::{json, Value};

// ---- 公共解析（对齐 dockerCreateHelpers.ts / restartPolicy.ts）----

const RESTART_POLICIES: [&str; 4] = ["no", "always", "unless-stopped", "on-failure"];

fn normalize_restart_policy(raw: &str) -> String {
    let n = raw.trim().to_lowercase();
    if RESTART_POLICIES.contains(&n.as_str()) {
        n
    } else {
        "no".to_string()
    }
}

fn restart_policy_to_docker(name: &str) -> Value {
    match name {
        "on-failure" => json!({ "Name": "on-failure", "MaximumRetryCount": 5 }),
        "no" => json!({ "Name": "no" }),
        other => json!({ "Name": other, "MaximumRetryCount": 0 }),
    }
}

/// 同上，但构造 bollard 类型（update_container 用）。
fn restart_policy_struct(name: &str) -> bollard::models::RestartPolicy {
    use bollard::models::RestartPolicyNameEnum as E;
    let (n, c) = match name {
        "on-failure" => (E::ON_FAILURE, Some(5)),
        "always" => (E::ALWAYS, Some(0)),
        "unless-stopped" => (E::UNLESS_STOPPED, Some(0)),
        _ => (E::NO, None),
    };
    bollard::models::RestartPolicy {
        name: Some(n),
        maximum_retry_count: c,
    }
}

fn parse_env_lines(text: &str) -> Vec<String> {
    text.lines()
        .map(|l| l.trim())
        .filter(|s| !s.is_empty() && !s.starts_with('#'))
        .map(|s| s.to_string())
        .collect()
}

fn is_ipv4(s: &str) -> bool {
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() == 4 && parts.iter().all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// 解析 "8080:80"、"8080:80/tcp"、"127.0.0.1:8080:80" 等；返回 (ExposedPorts, PortBindings)。
fn parse_port_publish(publish: &str) -> Option<(Value, Value)> {
    let mut exposed = serde_json::Map::new();
    let mut bindings: serde_json::Map<String, Value> = serde_json::Map::new();

    for raw in publish.split([' ', ',', ';', '\t', '\n']).map(|s| s.trim()).filter(|s| !s.is_empty()) {
        let (token, proto) = match raw.split_once('/') {
            Some((t, p)) => {
                let p = p.to_lowercase();
                if p != "tcp" && p != "udp" {
                    continue;
                }
                (t, p)
            }
            None => (raw, "tcp".to_string()),
        };
        let segs: Vec<&str> = token.split(':').collect();
        let (host_ip, host_port, container_port) = match segs.as_slice() {
            [h, c] => (None, *h, *c),
            [ip, h, c] if is_ipv4(ip) => (Some(*ip), *h, *c),
            _ => continue,
        };
        let nums_ok = host_port.chars().all(|c| c.is_ascii_digit())
            && container_port.chars().all(|c| c.is_ascii_digit())
            && !host_port.is_empty()
            && !container_port.is_empty();
        if !nums_ok {
            continue;
        }
        let key = format!("{container_port}/{proto}");
        exposed.insert(key.clone(), json!({}));
        let mut binding = serde_json::Map::new();
        if let Some(ip) = host_ip {
            binding.insert("HostIp".into(), json!(ip));
        }
        binding.insert("HostPort".into(), json!(host_port));
        bindings
            .entry(key)
            .or_insert_with(|| json!([]))
            .as_array_mut()
            .unwrap()
            .push(Value::Object(binding));
    }

    if exposed.is_empty() {
        None
    } else {
        Some((Value::Object(exposed), Value::Object(bindings)))
    }
}

fn split_cmd(cmd_text: &str) -> Option<Vec<String>> {
    let v: Vec<String> = cmd_text.split_whitespace().map(|s| s.to_string()).collect();
    if v.is_empty() {
        None
    } else {
        Some(v)
    }
}

fn normalize_name(raw: &Option<String>) -> Option<String> {
    raw.as_ref()
        .map(|s| s.trim().trim_start_matches('/').to_lowercase())
        .filter(|s| !s.is_empty())
}

async fn create_container_from_json(
    body: Value,
    name: Option<String>,
) -> Result<String, String> {
    let config: Config<String> = serde_json::from_value(body).map_err(|e| e.to_string())?;
    let d = get_docker()?;
    let opts = name.map(|name| CreateContainerOptions { name, platform: None });
    let resp = d.create_container(opts, config).await.map_err(|e| e.to_string())?;
    d.start_container(&resp.id, None::<bollard::container::StartContainerOptions<String>>)
        .await
        .map_err(|e| e.to_string())?;
    Ok(resp.id)
}

// ---- create-run ----

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRunPayload {
    image: Option<String>,
    name: Option<String>,
    env_text: Option<String>,
    publish_text: Option<String>,
    cmd_text: Option<String>,
    auto_remove: Option<bool>,
    restart_policy: Option<String>,
}

async fn create_run_inner(p: CreateRunPayload) -> Result<Value, String> {
    let image = p.image.as_deref().unwrap_or("").trim().to_string();
    if image.is_empty() {
        return Err("image is required".into());
    }
    let env = parse_env_lines(p.env_text.as_deref().unwrap_or(""));
    let ports = parse_port_publish(p.publish_text.as_deref().unwrap_or(""));
    let cmd = split_cmd(p.cmd_text.as_deref().unwrap_or("").trim());
    let name = normalize_name(&p.name);
    let auto_remove = p.auto_remove == Some(true);
    let rp = normalize_restart_policy(p.restart_policy.as_deref().unwrap_or("no"));

    let mut body = json!({ "Image": image });
    if !env.is_empty() {
        body["Env"] = json!(env);
    }
    if let Some(c) = cmd {
        body["Cmd"] = json!(c);
    }
    let mut hc = serde_json::Map::new();
    if auto_remove {
        hc.insert("AutoRemove".into(), json!(true));
    }
    hc.insert(
        "RestartPolicy".into(),
        restart_policy_to_docker(if auto_remove { "no" } else { &rp }),
    );
    if let Some((exposed, bindings)) = ports {
        body["ExposedPorts"] = exposed;
        hc.insert("PortBindings".into(), bindings);
    }
    body["HostConfig"] = Value::Object(hc);

    let id = create_container_from_json(body, name).await?;
    Ok(json!({ "id": id }))
}

#[tauri::command]
pub async fn docker_create_run_container(payload: CreateRunPayload) -> IpcResult<Value> {
    into_ipc(create_run_inner(payload).await)
}

// ---- recreate ----

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecreatePayload {
    container_id: Option<String>,
    image: Option<String>,
    name: Option<String>,
    env_text: Option<String>,
    publish_text: Option<String>,
    cmd_text: Option<String>,
    auto_remove: Option<bool>,
    restart_policy: Option<String>,
}

fn copy_if_nonempty_str(dst: &mut Value, key: &str, cfg: &Value) {
    if let Some(s) = cfg.get(key).and_then(|v| v.as_str()) {
        if !s.is_empty() {
            dst[key] = json!(s);
        }
    }
}

fn copy_through(dst: &mut Value, key: &str, cfg: &Value) {
    if let Some(v) = cfg.get(key) {
        if !v.is_null() {
            dst[key] = v.clone();
        }
    }
}

async fn recreate_inner(p: RecreatePayload) -> Result<Value, String> {
    let container_id = p.container_id.as_deref().unwrap_or("").trim().to_string();
    let image = p.image.as_deref().unwrap_or("").trim().to_string();
    if container_id.is_empty() {
        return Err("containerId is required".into());
    }
    if image.is_empty() {
        return Err("image is required".into());
    }
    let d = get_docker()?;
    let ins = d.inspect_container(&container_id, None).await.map_err(|e| e.to_string())?;
    let ins = serde_json::to_value(ins).map_err(|e| e.to_string())?;
    let cfg = ins.get("Config").cloned().unwrap_or(json!({}));

    let env = parse_env_lines(p.env_text.as_deref().unwrap_or(""));
    let ports = parse_port_publish(p.publish_text.as_deref().unwrap_or(""));
    let cmd = split_cmd(p.cmd_text.as_deref().unwrap_or("").trim());
    let auto_remove = p.auto_remove == Some(true);
    let rp = normalize_restart_policy(p.restart_policy.as_deref().unwrap_or("no"));

    // 旧 HostConfig：去掉 PortBindings，按入参覆盖 AutoRemove / RestartPolicy / PortBindings
    let mut hc = ins.get("HostConfig").cloned().unwrap_or(json!({}));
    if let Some(o) = hc.as_object_mut() {
        o.remove("PortBindings");
        if auto_remove {
            o.insert("AutoRemove".into(), json!(true));
        } else {
            o.remove("AutoRemove");
        }
        o.insert(
            "RestartPolicy".into(),
            restart_policy_to_docker(if auto_remove { "no" } else { &rp }),
        );
        o.insert(
            "PortBindings".into(),
            ports.as_ref().map(|(_, b)| b.clone()).unwrap_or(json!({})),
        );
    }

    let mut create = json!({ "Image": image });
    if !env.is_empty() {
        create["Env"] = json!(env);
    }
    if let Some(c) = cmd {
        create["Cmd"] = json!(c);
    }
    copy_through(&mut create, "Labels", &cfg);
    copy_if_nonempty_str(&mut create, "WorkingDir", &cfg);
    copy_if_nonempty_str(&mut create, "User", &cfg);
    copy_if_nonempty_str(&mut create, "Hostname", &cfg);
    copy_if_nonempty_str(&mut create, "Domainname", &cfg);
    for k in ["Tty", "OpenStdin", "AttachStdin", "AttachStdout", "AttachStderr", "StdinOnce"] {
        copy_through(&mut create, k, &cfg);
    }
    copy_through(&mut create, "Entrypoint", &cfg);
    copy_through(&mut create, "Healthcheck", &cfg);
    create["HostConfig"] = hc;

    // ExposedPorts：有新端口则合并旧的，否则沿用旧的
    match &ports {
        Some((exposed, _)) => {
            let mut merged = cfg.get("ExposedPorts").cloned().unwrap_or(json!({}));
            if let (Some(m), Some(e)) = (merged.as_object_mut(), exposed.as_object()) {
                for (k, v) in e {
                    m.insert(k.clone(), v.clone());
                }
            }
            create["ExposedPorts"] = merged;
        }
        None => {
            if let Some(ep) = cfg.get("ExposedPorts") {
                if ep.as_object().map(|o| !o.is_empty()).unwrap_or(false) {
                    create["ExposedPorts"] = ep.clone();
                }
            }
        }
    }

    // 容器名：入参 > 旧名 > 无
    let fallback = ins
        .get("Name")
        .and_then(|v| v.as_str())
        .map(|s| s.trim_start_matches('/').to_lowercase())
        .filter(|s| !s.is_empty());
    let name = normalize_name(&p.name).or(fallback);

    // 删除旧容器前处理状态
    let state = ins.get("State").cloned().unwrap_or(json!({}));
    let paused = state.get("Paused").and_then(|v| v.as_bool()).unwrap_or(false);
    let running = state.get("Running").and_then(|v| v.as_bool()).unwrap_or(false);
    let restarting = state.get("Restarting").and_then(|v| v.as_bool()).unwrap_or(false);
    if paused {
        d.unpause_container(&container_id).await.map_err(|e| e.to_string())?;
    }
    if running || restarting {
        d.stop_container(&container_id, Some(bollard::container::StopContainerOptions { t: 10 }))
            .await
            .map_err(|e| e.to_string())?;
    }
    d.remove_container(&container_id, None).await.map_err(|e| e.to_string())?;

    let id = create_container_from_json(create, name).await?;
    Ok(json!({ "id": id }))
}

#[tauri::command]
pub async fn docker_recreate_container(payload: RecreatePayload) -> IpcResult<Value> {
    into_ipc(recreate_inner(payload).await)
}

// ---- patch runtime ----

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchPayload {
    container_id: Option<String>,
    name: Option<String>,
    restart_policy: Option<String>,
    memory_mb: Option<f64>,
    cpus: Option<f64>,
    pids_limit: Option<f64>,
}

async fn patch_inner(p: PatchPayload) -> Result<(), String> {
    let container_id = p.container_id.as_deref().unwrap_or("").trim().to_string();
    if container_id.is_empty() {
        return Err("containerId is required".into());
    }
    let d = get_docker()?;
    let ins = d.inspect_container(&container_id, None).await.map_err(|e| e.to_string())?;
    let ins = serde_json::to_value(ins).map_err(|e| e.to_string())?;
    let hc = ins.get("HostConfig").cloned().unwrap_or(json!({}));

    let new_rp = normalize_restart_policy(p.restart_policy.as_deref().unwrap_or("no"));
    let auto_remove = hc.get("AutoRemove").and_then(|v| v.as_bool()).unwrap_or(false);
    if auto_remove && new_rp != "no" {
        return Err("Auto-remove containers only support restart policy \"no\" (Docker engine limitation).".into());
    }

    let current_name = ins
        .get("Name")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim_start_matches('/')
        .trim()
        .to_lowercase();
    let raw = p.name.as_deref().unwrap_or("").trim().trim_start_matches('/').to_string();
    let target_name = if raw.is_empty() { current_name.clone() } else { raw.to_lowercase() };
    let name_changed = target_name != current_name;

    let existing_rp = normalize_restart_policy(
        hc.get("RestartPolicy").and_then(|r| r.get("Name")).and_then(|n| n.as_str()).unwrap_or(""),
    );
    let mut restart_changed = existing_rp != new_rp;
    if !restart_changed && new_rp == "on-failure" {
        let cur_count = hc
            .get("RestartPolicy")
            .and_then(|r| r.get("MaximumRetryCount"))
            .and_then(|n| n.as_i64())
            .unwrap_or(5);
        restart_changed = cur_count != 5;
    }

    // UpdateContainerOptions 仅派生 Serialize，逐字段构造。
    let mut opts = UpdateContainerOptions::<String>::default();
    let mut need_update = false;
    if restart_changed {
        opts.restart_policy = Some(restart_policy_struct(&new_rp));
        need_update = true;
    }
    if let Some(mb) = p.memory_mb.filter(|v| v.is_finite()) {
        let mem = if mb <= 0.0 { 0 } else { (mb * 1024.0 * 1024.0).floor() as i64 };
        let cur = hc.get("Memory").and_then(|v| v.as_i64()).unwrap_or(0);
        if mem != cur {
            opts.memory = Some(mem);
            need_update = true;
        }
    }
    if let Some(cpus) = p.cpus.filter(|v| v.is_finite()) {
        let nanos = if cpus <= 0.0 { 0 } else { (cpus * 1e9).round() as i64 };
        let cur = hc.get("NanoCpus").and_then(|v| v.as_i64()).unwrap_or(0);
        if nanos != cur {
            opts.nano_cpus = Some(nanos);
            need_update = true;
        }
    }
    if let Some(pl) = p.pids_limit.filter(|v| v.is_finite()) {
        let lim = if pl <= 0.0 { 0 } else { pl.floor() as i64 };
        let cur = hc.get("PidsLimit").and_then(|v| v.as_i64()).unwrap_or(0);
        if lim != cur {
            opts.pids_limit = Some(lim);
            need_update = true;
        }
    }

    if !name_changed && !need_update {
        return Ok(());
    }
    if name_changed {
        d.rename_container(&container_id, RenameContainerOptions { name: target_name })
            .await
            .map_err(|e| e.to_string())?;
    }
    if need_update {
        d.update_container(&container_id, opts).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn docker_patch_runtime(payload: PatchPayload) -> IpcResult<()> {
    into_ipc(patch_inner(payload).await)
}

// ---- commit（CLI）----

async fn commit_inner(
    container_id: String,
    repo: String,
    tag: Option<String>,
    comment: Option<String>,
) -> Result<Value, String> {
    let container_id = container_id.trim().to_string();
    let repo = repo.trim().to_string();
    if container_id.is_empty() {
        return Err("containerId is required".into());
    }
    if repo.is_empty() {
        return Err("repo is required".into());
    }
    let tag = tag
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "latest".into());
    let target = format!("{repo}:{tag}");

    let mut argv: Vec<String> = vec!["commit".into()];
    if let Some(c) = comment.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        argv.push("-m".into());
        argv.push(c.to_string());
    }
    argv.push(container_id);
    argv.push(target);

    let id = cli::run_docker_capture(&argv).await?;
    let id = id.trim().to_string();
    if id.is_empty() {
        return Err("commit returned no image id".into());
    }
    Ok(json!({ "id": id }))
}

#[tauri::command]
pub async fn docker_commit_container(
    container_id: String,
    repo: String,
    tag: Option<String>,
    comment: Option<String>,
) -> IpcResult<Value> {
    into_ipc(commit_inner(container_id, repo, tag, comment).await)
}
