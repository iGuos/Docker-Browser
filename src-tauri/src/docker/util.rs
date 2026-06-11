//! Docker 命令共用的小工具：序列化为 JSON、单次 stats 抓取、内存用量抽取、批量并发。

use super::client::get_docker;
use bollard::container::StatsOptions;
use futures_util::stream::StreamExt;
use serde::Serialize;

/// 并发批量大小：避免一次性对引擎发起过多 stats 请求（对齐 Electron 版 CONTAINER_STATS_BATCH=8）。
pub const CONTAINER_STATS_BATCH: usize = 8;

/// 将任意可序列化值转为 serde_json::Value（前端按 unknown 消费，形状即 Docker API 原样）。
pub fn jv<T: Serialize>(v: T) -> Result<serde_json::Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}

/// 单次抓取容器 stats（stream=false，等同 dockerode `stats({stream:false})`），返回原始 JSON。
pub async fn fetch_stats_value(id: &str) -> Result<serde_json::Value, String> {
    let d = get_docker()?;
    let mut s = d.stats(
        id,
        Some(StatsOptions {
            stream: false,
            one_shot: false,
        }),
    );
    match s.next().await {
        Some(Ok(stats)) => jv(stats),
        Some(Err(e)) => Err(e.to_string()),
        None => Err("no stats returned".into()),
    }
}

/// 从一次 stats JSON 中抽取内存用量字节数：优先 memory_stats.usage，
/// 否则回退 memory_stats.stats.anon + .file（对齐 readContainerStatsMemoryUsageBytes）。
pub fn read_memory_usage_bytes(stats: &serde_json::Value) -> Option<u64> {
    let ms = stats.get("memory_stats")?;
    if let Some(usage) = ms.get("usage").and_then(|v| v.as_u64()) {
        return Some(usage);
    }
    let st = ms.get("stats")?;
    let anon = st.get("anon").and_then(|v| v.as_u64()).unwrap_or(0);
    let file = st.get("file").and_then(|v| v.as_u64()).unwrap_or(0);
    let t = anon + file;
    if t > 0 {
        Some(t)
    } else {
        None
    }
}
