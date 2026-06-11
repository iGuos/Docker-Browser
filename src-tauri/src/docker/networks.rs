//! 网络：list / remove / create / connect / disconnect。对齐 ipcDocker.ts。

use super::client::get_docker;
use super::util::jv;
use crate::ipc::{into_ipc, IpcResult};
use bollard::network::{
    ConnectNetworkOptions, CreateNetworkOptions, DisconnectNetworkOptions, ListNetworksOptions,
};
use serde_json::json;

async fn list_inner() -> Result<serde_json::Value, String> {
    let d = get_docker()?;
    let list = d
        .list_networks(None::<ListNetworksOptions<String>>)
        .await
        .map_err(|e| e.to_string())?;
    jv(list)
}

#[tauri::command]
pub async fn docker_list_networks() -> IpcResult<serde_json::Value> {
    into_ipc(list_inner().await)
}

async fn remove_inner(id: String) -> Result<(), String> {
    if id.is_empty() {
        return Err("invalid id".into());
    }
    let d = get_docker()?;
    d.remove_network(&id).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_remove_network(id: String) -> IpcResult<()> {
    into_ipc(remove_inner(id).await)
}

async fn create_inner(name: String, driver: Option<String>) -> Result<serde_json::Value, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("name is required".into());
    }
    let driver = driver
        .map(|d| d.trim().to_string())
        .filter(|d| !d.is_empty())
        .unwrap_or_else(|| "bridge".into());
    let d = get_docker()?;
    let res = d
        .create_network(CreateNetworkOptions {
            name: name.to_string(),
            driver,
            check_duplicate: true,
            ..Default::default()
        })
        .await
        .map_err(|e| e.to_string())?;
    Ok(json!({ "id": res.id }))
}

#[tauri::command]
pub async fn docker_create_network(
    name: String,
    driver: Option<String>,
) -> IpcResult<serde_json::Value> {
    into_ipc(create_inner(name, driver).await)
}

async fn connect_inner(network_id: String, container_id: String) -> Result<(), String> {
    let network_id = network_id.trim();
    let container_id = container_id.trim();
    if network_id.is_empty() || container_id.is_empty() {
        return Err("networkId and containerId are required".into());
    }
    let d = get_docker()?;
    d.connect_network(
        network_id,
        ConnectNetworkOptions {
            container: container_id.to_string(),
            endpoint_config: Default::default(),
        },
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_network_connect(
    network_id: String,
    container_id: String,
) -> IpcResult<()> {
    into_ipc(connect_inner(network_id, container_id).await)
}

async fn disconnect_inner(
    network_id: String,
    container_id: String,
    force: Option<bool>,
) -> Result<(), String> {
    let network_id = network_id.trim();
    let container_id = container_id.trim();
    if network_id.is_empty() || container_id.is_empty() {
        return Err("networkId and containerId are required".into());
    }
    let d = get_docker()?;
    d.disconnect_network(
        network_id,
        DisconnectNetworkOptions {
            container: container_id.to_string(),
            force: force == Some(true),
        },
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_network_disconnect(
    network_id: String,
    container_id: String,
    force: Option<bool>,
) -> IpcResult<()> {
    into_ipc(disconnect_inner(network_id, container_id, force).await)
}
