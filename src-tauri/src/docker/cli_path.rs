//! 跨平台解析 docker 二进制路径，并构造前置了常见安装目录的 PATH。
//! 对齐 Electron 版 dockerCliPath.ts：GUI 启动的进程 PATH 常过短，找不到 Homebrew /
//! Docker Desktop 的 docker，故优先返回绝对路径并前置候选目录。

use std::path::Path;

#[cfg(target_os = "macos")]
const DOCKER_DESKTOP_MAC_CLI: &str = "/Applications/Docker.app/Contents/Resources/bin/docker";

/// 解析可执行 docker 的绝对路径（portable-pty / 子进程 spawn 用）。
pub fn resolve_docker_bin() -> String {
    #[cfg(target_os = "windows")]
    {
        return "docker.exe".to_string();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let candidates: &[&str] = &[
            #[cfg(target_os = "macos")]
            DOCKER_DESKTOP_MAC_CLI,
            "/opt/homebrew/bin/docker",
            "/usr/local/bin/docker",
            "/usr/bin/docker",
            "/snap/bin/docker",
        ];
        for c in candidates {
            if Path::new(c).exists() {
                return c.to_string();
            }
        }
        "docker".to_string()
    }
}

/// 需要前置到 PATH 的目录（按平台）。
fn path_prefixes() -> Vec<&'static str> {
    #[cfg(target_os = "windows")]
    {
        Vec::new()
    }
    #[cfg(target_os = "macos")]
    {
        vec![
            "/Applications/Docker.app/Contents/Resources/bin",
            "/opt/homebrew/bin",
            "/usr/local/bin",
        ]
    }
    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        vec!["/usr/local/bin", "/snap/bin"]
    }
}

/// 返回前置了候选目录的 PATH 值；无需修改时返回 None。
pub fn extended_path() -> Option<String> {
    let prefixes = path_prefixes();
    if prefixes.is_empty() {
        return None;
    }
    let sep = if cfg!(windows) { ";" } else { ":" };
    let extra = prefixes.join(sep);
    Some(match std::env::var("PATH") {
        Ok(cur) if !cur.is_empty() => format!("{extra}{sep}{cur}"),
        _ => extra,
    })
}
