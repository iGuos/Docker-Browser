//! Docker Engine 相关命令（bollard）。本文件随迁移阶段逐步扩充。
//! 命名约定：Tauri 命令用 snake_case（前端 backendBridge 负责映射到原 `docker:*` 方法名）。

pub mod cli;
pub mod cli_path;
pub mod client;
pub mod container_fs;
pub mod containers;
pub mod create;
pub mod events;
pub mod exec_once;
pub mod exec_pty;
pub mod images;
pub mod logs;
pub mod networks;
pub mod util;
pub mod volumes;

use crate::ipc::{into_ipc, IpcResult};
use client::{get_docker, reset_docker};
use util::jv;

// ---- P0/P1：连通性探针 ----

async fn ping_inner() -> Result<String, String> {
    let d = get_docker()?;
    d.ping().await.map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_ping() -> IpcResult<String> {
    into_ipc(ping_inner().await)
}

async fn info_inner() -> Result<serde_json::Value, String> {
    let d = get_docker()?;
    let info = d.info().await.map_err(|e| e.to_string())?;
    serde_json::to_value(info).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_info() -> IpcResult<serde_json::Value> {
    into_ipc(info_inner().await)
}

async fn version_inner() -> Result<serde_json::Value, String> {
    let d = get_docker()?;
    let v = d.version().await.map_err(|e| e.to_string())?;
    serde_json::to_value(v).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_version() -> IpcResult<serde_json::Value> {
    into_ipc(version_inner().await)
}

#[tauri::command]
pub async fn docker_reconnect() -> IpcResult<()> {
    reset_docker();
    // 立即重连一次，验证可达性
    into_ipc(ping_inner().await.map(|_| ()))
}

async fn df_inner() -> Result<serde_json::Value, String> {
    let d = get_docker()?;
    let res = d.df().await.map_err(|e| e.to_string())?;
    jv(res)
}

#[tauri::command]
pub async fn docker_df() -> IpcResult<serde_json::Value> {
    into_ipc(df_inner().await)
}
