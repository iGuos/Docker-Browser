use crate::docker_client::get_docker;
use crate::error::Result;
use bollard::network::{ConnectNetworkOptions, CreateNetworkOptions, DisconnectNetworkOptions, ListNetworksOptions};
use serde::Serialize;
use serde_json::Value;

#[tauri::command]
pub async fn list_networks() -> Result<Vec<Value>> {
    let list = get_docker().list_networks(None::<ListNetworksOptions<String>>).await?;
    Ok(list.into_iter().map(|n| serde_json::to_value(n).unwrap_or(Value::Null)).collect())
}

#[tauri::command]
pub async fn remove_network(id: String) -> Result<()> {
    get_docker().remove_network(&id).await?;
    Ok(())
}

#[derive(Serialize)]
pub struct NetworkIdResult {
    pub id: String,
}

#[tauri::command]
pub async fn create_network(name: String, driver: Option<String>) -> Result<NetworkIdResult> {
    let resp = get_docker()
        .create_network(CreateNetworkOptions {
            name: name.as_str(),
            driver: driver.as_deref().unwrap_or("bridge"),
            ..Default::default()
        })
        .await?;
    Ok(NetworkIdResult { id: resp.id })
}

#[tauri::command]
pub async fn network_connect(network_id: String, container_id: String) -> Result<()> {
    get_docker()
        .connect_network(&network_id, ConnectNetworkOptions {
            container: container_id.as_str(),
            ..Default::default()
        })
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn network_disconnect(network_id: String, container_id: String, force: Option<bool>) -> Result<()> {
    get_docker()
        .disconnect_network(&network_id, DisconnectNetworkOptions {
            container: container_id.as_str(),
            force: force.unwrap_or(false),
        })
        .await?;
    Ok(())
}
