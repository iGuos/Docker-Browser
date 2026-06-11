//! 主进程 → 渲染进程的事件名常量。必须与前端 shared/*IpcChannels 中的字符串完全一致，
//! 前端 backendBridge 用这些名字 listen 并按 subscriptionId/requestId 过滤。

pub const LOGS_CHUNK: &str = "docker:logs:chunk";
pub const EVENTS_CHUNK: &str = "docker:events:chunk";
pub const EXEC_PTY_DATA: &str = "docker:exec-pty-data";
pub const EXEC_PTY_EXIT: &str = "docker:exec-pty-exit";
pub const CLI_PROGRESS: &str = "docker:docker-cli-progress";
pub const UPDATE_STATUS: &str = "app:update-status";
pub const MENU_THEME: &str = "app-menu:theme";
pub const MENU_LANGUAGE: &str = "app-menu:language";
