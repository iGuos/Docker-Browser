//! 镜像：list / inspect / remove / pull / tag / history。对齐 ipcDocker.ts。
//! 注：commit / save / load 因分别依赖 CLI 与文件对话框，放在 P4 / P6。

use super::client::get_docker;
use super::util::jv;
use crate::ipc::{into_ipc, IpcResult};
use bollard::image::{CreateImageOptions, ListImagesOptions, RemoveImageOptions, TagImageOptions};
use futures_util::stream::StreamExt;

async fn list_inner() -> Result<serde_json::Value, String> {
    let d = get_docker()?;
    let list = d
        .list_images(None::<ListImagesOptions<String>>)
        .await
        .map_err(|e| e.to_string())?;
    jv(list)
}

#[tauri::command]
pub async fn docker_list_images() -> IpcResult<serde_json::Value> {
    into_ipc(list_inner().await)
}

async fn inspect_inner(name: String) -> Result<serde_json::Value, String> {
    if name.is_empty() {
        return Err("invalid name".into());
    }
    let d = get_docker()?;
    let ins = d.inspect_image(&name).await.map_err(|e| e.to_string())?;
    jv(ins)
}

#[tauri::command]
pub async fn docker_inspect_image(name: String) -> IpcResult<serde_json::Value> {
    into_ipc(inspect_inner(name).await)
}

async fn remove_inner(
    name: String,
    force: Option<bool>,
    noprune: Option<bool>,
) -> Result<serde_json::Value, String> {
    if name.is_empty() {
        return Err("invalid name".into());
    }
    let d = get_docker()?;
    let opts = RemoveImageOptions {
        force: force == Some(true),
        noprune: noprune == Some(true),
    };
    let res = d
        .remove_image(&name, Some(opts), None)
        .await
        .map_err(|e| e.to_string())?;
    jv(res)
}

#[tauri::command]
pub async fn docker_remove_image(
    name: String,
    force: Option<bool>,
    noprune: Option<bool>,
) -> IpcResult<serde_json::Value> {
    into_ipc(remove_inner(name, force, noprune).await)
}

/// 把 "repo:tag" 拆成 (image, tag)。仅当最后一个冒号之后不含 '/' 时才视作 tag，
/// 避免把 "registry:5000/img" 的端口误判为 tag。
fn split_repo_tag(repo_tag: &str) -> (String, String) {
    if let Some(i) = repo_tag.rfind(':') {
        if !repo_tag[i + 1..].contains('/') {
            return (repo_tag[..i].to_string(), repo_tag[i + 1..].to_string());
        }
    }
    (repo_tag.to_string(), "latest".to_string())
}

async fn pull_inner(repo_tag: String) -> Result<(), String> {
    if repo_tag.is_empty() {
        return Err("invalid repoTag".into());
    }
    let d = get_docker()?;
    let (from_image, tag) = split_repo_tag(&repo_tag);
    let opts = CreateImageOptions::<String> {
        from_image,
        tag,
        ..Default::default()
    };
    let mut stream = d.create_image(Some(opts), None, None);
    // 消费整个进度流，等价 dockerode modem.followProgress 到 done；任一帧出错即失败。
    while let Some(item) = stream.next().await {
        item.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn docker_pull_image(repo_tag: String) -> IpcResult<()> {
    into_ipc(pull_inner(repo_tag).await)
}

async fn tag_inner(source: String, repo: String, tag: Option<String>) -> Result<(), String> {
    let source = source.trim();
    let repo = repo.trim();
    if source.is_empty() || repo.is_empty() {
        return Err("source and repo are required".into());
    }
    let tag = tag
        .map(|t| t.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| "latest".into());
    let d = get_docker()?;
    d.tag_image(
        source,
        Some(TagImageOptions {
            repo: repo.to_string(),
            tag,
        }),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_tag_image(
    source: String,
    repo: String,
    tag: Option<String>,
) -> IpcResult<()> {
    into_ipc(tag_inner(source, repo, tag).await)
}

async fn history_inner(name: String) -> Result<serde_json::Value, String> {
    if name.is_empty() {
        return Err("invalid name".into());
    }
    let d = get_docker()?;
    let h = d.image_history(&name).await.map_err(|e| e.to_string())?;
    jv(h)
}

#[tauri::command]
pub async fn docker_image_history(name: String) -> IpcResult<serde_json::Value> {
    into_ipc(history_inner(name).await)
}
