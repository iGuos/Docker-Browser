//! 卷：list / remove / create / used-by。对齐 ipcDocker.ts。

use super::client::get_docker;
use super::util::jv;
use crate::ipc::{into_ipc, IpcResult};
use bollard::container::ListContainersOptions;
use bollard::volume::{CreateVolumeOptions, ListVolumesOptions};
use serde_json::json;

async fn list_inner() -> Result<serde_json::Value, String> {
    let d = get_docker()?;
    let res = d
        .list_volumes(None::<ListVolumesOptions<String>>)
        .await
        .map_err(|e| e.to_string())?;
    jv(res)
}

#[tauri::command]
pub async fn docker_list_volumes() -> IpcResult<serde_json::Value> {
    into_ipc(list_inner().await)
}

async fn remove_inner(name: String) -> Result<(), String> {
    if name.is_empty() {
        return Err("invalid name".into());
    }
    let d = get_docker()?;
    d.remove_volume(&name, None).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_remove_volume(name: String) -> IpcResult<()> {
    into_ipc(remove_inner(name).await)
}

async fn create_inner(name: String) -> Result<serde_json::Value, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("name is required".into());
    }
    let d = get_docker()?;
    d.create_volume(CreateVolumeOptions {
        name: name.to_string(),
        ..Default::default()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(json!({ "name": name }))
}

#[tauri::command]
pub async fn docker_create_volume(name: String) -> IpcResult<serde_json::Value> {
    into_ipc(create_inner(name).await)
}

/// 反查使用某卷的容器：列出全部容器，匹配 Mounts 中 Type=="volume" 且 Name==卷名。
async fn used_by_inner(volume_name: String) -> Result<serde_json::Value, String> {
    let name = volume_name.trim();
    if name.is_empty() {
        return Err("volume name required".into());
    }
    let d = get_docker()?;
    let list = d
        .list_containers(Some(ListContainersOptions::<String> {
            all: true,
            ..Default::default()
        }))
        .await
        .map_err(|e| e.to_string())?;
    let listv = jv(list)?;
    let mut container_ids: Vec<String> = Vec::new();
    if let Some(rows) = listv.as_array() {
        for row in rows {
            let used = row
                .get("Mounts")
                .and_then(|m| m.as_array())
                .map(|mounts| {
                    mounts.iter().any(|m| {
                        m.get("Type").and_then(|t| t.as_str()) == Some("volume")
                            && m.get("Name").and_then(|n| n.as_str()) == Some(name)
                    })
                })
                .unwrap_or(false);
            if used {
                if let Some(id) = row.get("Id").and_then(|i| i.as_str()) {
                    container_ids.push(id.to_string());
                }
            }
        }
    }
    Ok(json!({ "containerIds": container_ids }))
}

#[tauri::command]
pub async fn docker_volume_used_by(volume_name: String) -> IpcResult<serde_json::Value> {
    into_ipc(used_by_inner(volume_name).await)
}
