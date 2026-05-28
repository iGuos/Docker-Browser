use crate::docker_client::get_docker;
use crate::error::Result;
use bollard::volume::{CreateVolumeOptions, ListVolumesOptions};
use serde::Serialize;
use serde_json::Value;

#[tauri::command]
pub async fn list_volumes() -> Result<Value> {
    let resp = get_docker()
        .list_volumes(None::<ListVolumesOptions<String>>)
        .await?;
    Ok(serde_json::to_value(resp).unwrap_or(Value::Null))
}

#[tauri::command]
pub async fn remove_volume(name: String) -> Result<()> {
    get_docker().remove_volume(&name, None).await?;
    Ok(())
}

#[derive(Serialize)]
pub struct VolumeNameResult {
    pub name: String,
}

#[tauri::command]
pub async fn create_volume(name: String) -> Result<VolumeNameResult> {
    let resp = get_docker()
        .create_volume(CreateVolumeOptions {
            name: name.as_str(),
            ..Default::default()
        })
        .await?;
    Ok(VolumeNameResult { name: resp.name })
}

#[derive(Serialize)]
pub struct VolumeUsedByResult {
    pub container_ids: Vec<String>,
}

#[tauri::command]
pub async fn volume_used_by(volume_name: String) -> Result<VolumeUsedByResult> {
    use bollard::container::ListContainersOptions;
    use std::collections::HashMap;

    let mut filters = HashMap::new();
    filters.insert("volume".to_string(), vec![volume_name]);

    let list = get_docker()
        .list_containers(Some(ListContainersOptions {
            all: true,
            filters,
            ..Default::default()
        }))
        .await?;

    let container_ids = list.into_iter().filter_map(|c| c.id).collect();
    Ok(VolumeUsedByResult { container_ids })
}
