//! bollard Docker 客户端的缓存与重连（替代 Electron 版 dockerClient.ts 的单例 + resetDockerClient）。
//! `connect_with_local_defaults` 会读取 DOCKER_HOST/unix socket/npipe。

use bollard::Docker;
use std::sync::{Mutex, OnceLock};

static DOCKER: OnceLock<Mutex<Option<Docker>>> = OnceLock::new();

fn cell() -> &'static Mutex<Option<Docker>> {
    DOCKER.get_or_init(|| Mutex::new(None))
}

/// 返回缓存的客户端（首次调用时建立连接）。Docker 内部是 Arc，clone 廉价。
pub fn get_docker() -> Result<Docker, String> {
    let mut guard = cell().lock().map_err(|e| e.to_string())?;
    if let Some(d) = guard.as_ref() {
        return Ok(d.clone());
    }
    let d = Docker::connect_with_local_defaults().map_err(|e| e.to_string())?;
    *guard = Some(d.clone());
    Ok(d)
}

/// 丢弃缓存的客户端，强制下次重连（用于 reconnect-docker / DOCKER_HOST 变更）。
pub fn reset_docker() {
    if let Ok(mut guard) = cell().lock() {
        *guard = None;
    }
}
