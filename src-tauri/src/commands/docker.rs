use crate::docker_client::{get_docker, reconnect};
use crate::error::Result;
use serde_json::Value;

#[tauri::command]
pub async fn ping() -> Result<String> {
    get_docker().ping().await?;
    Ok("OK".to_string())
}

#[tauri::command]
pub async fn info() -> Result<Value> {
    let info = get_docker().info().await?;
    Ok(serde_json::to_value(info).unwrap_or(Value::Null))
}

#[tauri::command]
pub async fn version() -> Result<Value> {
    let v = get_docker().version().await?;
    Ok(serde_json::to_value(v).unwrap_or(Value::Null))
}

#[tauri::command]
pub async fn df() -> Result<Value> {
    let df = get_docker().df().await?;
    Ok(serde_json::to_value(df).unwrap_or(Value::Null))
}

#[tauri::command]
pub async fn reconnect_docker() -> Result<String> {
    reconnect().map_err(crate::error::AppError::from)?;
    Ok("OK".to_string())
}
