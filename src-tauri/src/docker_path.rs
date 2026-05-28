use std::collections::HashMap;

const DOCKER_DESKTOP_MAC_CLI: &str =
    "/Applications/Docker.app/Contents/Resources/bin/docker";

/// 跨平台解析 docker 可执行文件绝对路径。
/// 在 macOS GUI 环境中 PATH 可能不包含 Docker CLI，需要探测已知位置。
pub fn resolve_docker_bin() -> String {
    #[cfg(target_os = "windows")]
    return "docker.exe".to_string();

    #[cfg(not(target_os = "windows"))]
    {
        let candidates: &[&str] = &[
            DOCKER_DESKTOP_MAC_CLI,
            "/opt/homebrew/bin/docker",
            "/usr/local/bin/docker",
            "/usr/bin/docker",
            "/snap/bin/docker",
        ];
        for &p in candidates {
            if std::path::Path::new(p).exists() {
                return p.to_string();
            }
        }
        "docker".to_string()
    }
}

/// 在 macOS GUI 进程中 PATH 过短，前置已知 Docker/Homebrew bin 目录。
pub fn env_with_docker_cli_in_path() -> HashMap<String, String> {
    let mut env: HashMap<String, String> = std::env::vars().collect();

    #[cfg(target_os = "macos")]
    {
        let prefixes = [
            std::path::Path::new(DOCKER_DESKTOP_MAC_CLI)
                .parent()
                .unwrap()
                .to_str()
                .unwrap_or(""),
            "/opt/homebrew/bin",
            "/usr/local/bin",
        ];
        let extra = prefixes
            .iter()
            .filter(|p| !p.is_empty())
            .cloned()
            .collect::<Vec<_>>()
            .join(":");
        let cur = env.get("PATH").cloned().unwrap_or_default();
        let new_path = if cur.is_empty() {
            extra
        } else {
            format!("{extra}:{cur}")
        };
        env.insert("PATH".to_string(), new_path);
    }

    #[cfg(target_os = "linux")]
    {
        let extra = "/usr/local/bin:/snap/bin";
        let cur = env.get("PATH").cloned().unwrap_or_default();
        let new_path = if cur.is_empty() {
            extra.to_string()
        } else {
            format!("{extra}:{cur}")
        };
        env.insert("PATH".to_string(), new_path);
    }

    env
}
