use crate::error::{AppError, Result};
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

fn focus_existing(app: &AppHandle, label: &str) -> bool {
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.set_focus();
        return true;
    }
    false
}

fn build_window(
    app: &AppHandle,
    label: String,
    url: String,
    title: &str,
    size: (f64, f64),
    min_size: (f64, f64),
) -> Result<()> {
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(size.0, size.1)
        .min_inner_size(min_size.0, min_size.1)
        .build()
        .map_err(|e| AppError(e.to_string()))?;
    Ok(())
}

#[tauri::command]
pub async fn open_container_logs_window(app: AppHandle, container_id: String) -> Result<()> {
    let label = format!("logs-{}", sanitize_label(&container_id));
    if focus_existing(&app, &label) {
        return Ok(());
    }
    build_window(
        &app,
        label,
        format!("index.html#logs?containerId={container_id}"),
        "Container Logs",
        (920.0, 640.0),
        (400.0, 280.0),
    )
}

#[tauri::command]
pub async fn open_container_exec_window(app: AppHandle, container_id: String) -> Result<()> {
    let label = format!("exec-{}", sanitize_label(&container_id));
    if focus_existing(&app, &label) {
        return Ok(());
    }
    build_window(
        &app,
        label,
        format!("index.html#exec?containerId={container_id}"),
        "Container Terminal",
        (800.0, 500.0),
        (400.0, 300.0),
    )
}

#[tauri::command]
pub async fn open_container_files_window(
    app: AppHandle,
    container_id: String,
    initial_path: Option<String>,
) -> Result<()> {
    let label = format!("files-{}", sanitize_label(&container_id));
    if focus_existing(&app, &label) {
        return Ok(());
    }
    let path_q = initial_path
        .as_deref()
        .map(|p| format!("&path={}", urlencoding::encode(p)))
        .unwrap_or_default();
    build_window(
        &app,
        label,
        format!("index.html#files?containerId={container_id}{path_q}"),
        "Container Files",
        (900.0, 620.0),
        (400.0, 300.0),
    )
}

/// Tauri 窗口 label 只允许 [a-zA-Z0-9-_/:]，把容器 ID 中可能的特殊字符替换掉
fn sanitize_label(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .take(40)
        .collect()
}
