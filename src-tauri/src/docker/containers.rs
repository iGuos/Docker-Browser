//! 容器：生命周期、inspect、stats、内存汇总。对齐 ipcDocker.ts 同名 handler。

use super::client::get_docker;
use super::util::{fetch_stats_value, jv, read_memory_usage_bytes, CONTAINER_STATS_BATCH};
use crate::ipc::{into_ipc, IpcResult};
use bollard::container::{ListContainersOptions, RemoveContainerOptions};
use futures_util::future::join_all;
use serde::Serialize;

fn nonempty(s: &str) -> Result<&str, String> {
    if s.is_empty() {
        Err("invalid id".into())
    } else {
        Ok(s)
    }
}

// ---- 列表 / inspect ----

async fn list_inner(all: Option<bool>) -> Result<serde_json::Value, String> {
    let d = get_docker()?;
    // 对齐：all = opts?.all !== false（默认显示全部，仅显式 false 才只看运行中）
    let opts = ListContainersOptions::<String> {
        all: all != Some(false),
        ..Default::default()
    };
    let list = d.list_containers(Some(opts)).await.map_err(|e| e.to_string())?;
    jv(list)
}

#[tauri::command]
pub async fn docker_list_containers(all: Option<bool>) -> IpcResult<serde_json::Value> {
    into_ipc(list_inner(all).await)
}

async fn inspect_inner(id: String) -> Result<serde_json::Value, String> {
    let d = get_docker()?;
    let ins = d
        .inspect_container(nonempty(&id)?, None)
        .await
        .map_err(|e| e.to_string())?;
    jv(ins)
}

#[tauri::command]
pub async fn docker_inspect_container(id: String) -> IpcResult<serde_json::Value> {
    into_ipc(inspect_inner(id).await)
}

// ---- 生命周期（统一 Result<(), String>）----

macro_rules! lifecycle_cmd {
    ($cmd:ident, $inner:ident, |$d:ident, $id:ident| $call:expr) => {
        async fn $inner(id: String) -> Result<(), String> {
            let $d = get_docker()?;
            let $id = nonempty(&id)?;
            $call.await.map_err(|e: bollard::errors::Error| e.to_string())
        }
        #[tauri::command]
        pub async fn $cmd(id: String) -> IpcResult<()> {
            into_ipc($inner(id).await)
        }
    };
}

lifecycle_cmd!(docker_start_container, start_inner, |d, id| d
    .start_container(id, None::<bollard::container::StartContainerOptions<String>>));
lifecycle_cmd!(docker_stop_container, stop_inner, |d, id| d.stop_container(id, None));
lifecycle_cmd!(docker_restart_container, restart_inner, |d, id| d
    .restart_container(id, None));
lifecycle_cmd!(docker_kill_container, kill_inner, |d, id| d
    .kill_container(id, None::<bollard::container::KillContainerOptions<String>>));
lifecycle_cmd!(docker_pause_container, pause_inner, |d, id| d.pause_container(id));
lifecycle_cmd!(docker_unpause_container, unpause_inner, |d, id| d.unpause_container(id));

async fn remove_inner(id: String, force: Option<bool>, v: Option<bool>) -> Result<(), String> {
    let d = get_docker()?;
    let opts = RemoveContainerOptions {
        force: force == Some(true),
        v: v == Some(true),
        link: false,
    };
    d.remove_container(nonempty(&id)?, Some(opts))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_remove_container(
    id: String,
    force: Option<bool>,
    v: Option<bool>,
) -> IpcResult<()> {
    into_ipc(remove_inner(id, force, v).await)
}

// ---- stats / 内存 ----

async fn stats_once_inner(id: String) -> Result<serde_json::Value, String> {
    fetch_stats_value(nonempty(&id)?).await
}

#[tauri::command]
pub async fn docker_container_stats_once(id: String) -> IpcResult<serde_json::Value> {
    into_ipc(stats_once_inner(id).await)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemorySummary {
    used_bytes: u64,
    counted_containers: u64,
    skipped_containers: u64,
}

/// 对一组 id 分批（每批 ≤8）并发抓取内存用量；返回 (used, counted, skipped) 三元组之和的累加片段。
async fn collect_memory_parts(ids: &[String]) -> Vec<(u64, u64, u64)> {
    let mut parts: Vec<(u64, u64, u64)> = Vec::with_capacity(ids.len());
    for chunk in ids.chunks(CONTAINER_STATS_BATCH) {
        let futs = chunk.iter().map(|id| async move {
            if id.is_empty() {
                return (0u64, 0u64, 1u64);
            }
            match fetch_stats_value(id).await {
                Ok(v) => match read_memory_usage_bytes(&v) {
                    Some(u) => (u, 1, 0),
                    None => (0, 0, 1),
                },
                Err(_) => (0, 0, 1),
            }
        });
        parts.extend(join_all(futs).await);
    }
    parts
}

async fn running_mem_summary_inner() -> Result<MemorySummary, String> {
    let d = get_docker()?;
    // 对齐：listContainers() 不传 opts → 仅运行中
    let list = d
        .list_containers(None::<ListContainersOptions<String>>)
        .await
        .map_err(|e| e.to_string())?;
    let ids: Vec<String> = list
        .iter()
        .map(|c| c.id.clone().unwrap_or_default())
        .collect();
    let parts = collect_memory_parts(&ids).await;
    let used_bytes = parts.iter().map(|p| p.0).sum();
    let counted_containers = parts.iter().map(|p| p.1).sum();
    let skipped_containers = parts.iter().map(|p| p.2).sum();
    Ok(MemorySummary {
        used_bytes,
        counted_containers,
        skipped_containers,
    })
}

#[tauri::command]
pub async fn docker_running_mem_summary() -> IpcResult<MemorySummary> {
    into_ipc(running_mem_summary_inner().await)
}

async fn containers_mem_usage_inner(
    container_ids: Vec<String>,
) -> Result<std::collections::HashMap<String, u64>, String> {
    let ids: Vec<String> = container_ids
        .into_iter()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let mut out = std::collections::HashMap::new();
    for chunk in ids.chunks(CONTAINER_STATS_BATCH) {
        let futs = chunk.iter().map(|id| async move {
            match fetch_stats_value(id).await {
                Ok(v) => read_memory_usage_bytes(&v).map(|u| (id.clone(), u)),
                Err(_) => None,
            }
        });
        for r in join_all(futs).await.into_iter().flatten() {
            out.insert(r.0, r.1);
        }
    }
    Ok(out)
}

#[tauri::command]
pub async fn docker_containers_mem_usage(
    container_ids: Vec<String>,
) -> IpcResult<std::collections::HashMap<String, u64>> {
    into_ipc(containers_mem_usage_inner(container_ids).await)
}
