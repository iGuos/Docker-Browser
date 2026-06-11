//! 文件对话框相关：镜像 save/load、容器 export、容器文件 download/upload。
//! 用 tauri-plugin-dialog 替代 Electron showSaveDialog/showOpenDialog。对齐 ipcDocker.ts。

use crate::docker::client::get_docker;
use crate::docker::container_fs::{
    normalize_container_path, pack_single_file, posix_basename, CONTAINER_FS_MAX_READ_BYTES,
};
use crate::ipc::{into_ipc, IpcResult};
use bollard::container::{DownloadFromContainerOptions, UploadToContainerOptions};
use bollard::image::ImportImageOptions;
use bytes::Bytes;
use futures_util::stream::StreamExt;
use serde_json::json;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;
use tokio::io::AsyncWriteExt;

/// 在阻塞线程弹出保存对话框，返回选中路径。
async fn pick_save(app: &AppHandle, title: &str, default_name: &str) -> Result<Option<PathBuf>, String> {
    let app = app.clone();
    let title = title.to_string();
    let name = default_name.to_string();
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_title(&title)
            .set_file_name(&name)
            .add_filter("Tar", &["tar"])
            .blocking_save_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(chosen.and_then(|f| f.into_path().ok()))
}

async fn pick_open(app: &AppHandle, title: &str) -> Result<Option<PathBuf>, String> {
    let app = app.clone();
    let title = title.to_string();
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_title(&title).add_filter("Tar", &["tar"]).blocking_pick_file()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(chosen.and_then(|f| f.into_path().ok()))
}

async fn pick_open_many(app: &AppHandle, title: &str) -> Result<Vec<PathBuf>, String> {
    let app = app.clone();
    let title = title.to_string();
    let chosen = tauri::async_runtime::spawn_blocking(move || {
        app.dialog().file().set_title(&title).blocking_pick_files()
    })
    .await
    .map_err(|e| e.to_string())?;
    Ok(chosen
        .unwrap_or_default()
        .into_iter()
        .filter_map(|f| f.into_path().ok())
        .collect())
}

/// 把 Bytes 流写入文件。
async fn write_stream_to_file<S>(mut stream: S, path: &PathBuf) -> Result<(), String>
where
    S: futures_util::Stream<Item = Result<Bytes, bollard::errors::Error>> + Unpin,
{
    let mut file = tokio::fs::File::create(path).await.map_err(|e| e.to_string())?;
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
    }
    file.flush().await.map_err(|e| e.to_string())?;
    Ok(())
}

// ---- 镜像 save / load ----

async fn save_image_inner(app: AppHandle, name: String) -> Result<serde_json::Value, String> {
    let name = name.trim().to_string();
    if name.is_empty() {
        return Err("image name is required".into());
    }
    let Some(path) = pick_save(&app, "Save image as tar", "image.tar").await? else {
        return Err("cancelled".into());
    };
    let d = get_docker()?;
    write_stream_to_file(d.export_image(&name), &path).await?;
    Ok(json!({ "filePath": path.to_string_lossy() }))
}

#[tauri::command]
pub async fn docker_save_image_tar(app: AppHandle, name: String) -> IpcResult<serde_json::Value> {
    into_ipc(save_image_inner(app, name).await)
}

async fn load_image_inner(app: AppHandle) -> Result<(), String> {
    let Some(path) = pick_open(&app, "Load image from tar").await? else {
        return Err("cancelled".into());
    };
    let bytes = tokio::fs::read(&path).await.map_err(|e| e.to_string())?;
    let d = get_docker()?;
    let mut stream = d.import_image(ImportImageOptions { quiet: false }, Bytes::from(bytes), None);
    while let Some(item) = stream.next().await {
        item.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn docker_load_image_tar(app: AppHandle) -> IpcResult<()> {
    into_ipc(load_image_inner(app).await)
}

// ---- 容器 export ----

async fn export_container_inner(
    app: AppHandle,
    container_id: String,
) -> Result<serde_json::Value, String> {
    let container_id = container_id.trim().to_string();
    if container_id.is_empty() {
        return Err("containerId is required".into());
    }
    let Some(path) = pick_save(&app, "Export container as tar", "container-export.tar").await? else {
        return Err("cancelled".into());
    };
    let d = get_docker()?;
    write_stream_to_file(d.export_container(&container_id), &path).await?;
    Ok(json!({ "filePath": path.to_string_lossy() }))
}

#[tauri::command]
pub async fn docker_export_container_tar(
    app: AppHandle,
    container_id: String,
) -> IpcResult<serde_json::Value> {
    into_ipc(export_container_inner(app, container_id).await)
}

// ---- 容器文件 download / upload ----

async fn fs_download_inner(
    app: AppHandle,
    container_id: String,
    path: String,
) -> Result<serde_json::Value, String> {
    let container_id = container_id.trim().to_string();
    if container_id.is_empty() {
        return Err("containerId is required".into());
    }
    if path.trim().is_empty() {
        return Err("path is required".into());
    }
    let remote = normalize_container_path(&path)?;
    let base = posix_basename(&remote);
    let default_name = if base.is_empty() { "download.tar" } else { base };
    let Some(save_path) = pick_save(&app, "Download from container", default_name).await? else {
        return Err("cancelled".into());
    };
    let d = get_docker()?;
    write_stream_to_file(
        d.download_from_container(&container_id, Some(DownloadFromContainerOptions { path: remote })),
        &save_path,
    )
    .await?;
    Ok(json!({ "filePath": save_path.to_string_lossy() }))
}

#[tauri::command]
pub async fn docker_fs_download(
    app: AppHandle,
    container_id: String,
    path: String,
) -> IpcResult<serde_json::Value> {
    into_ipc(fs_download_inner(app, container_id, path).await)
}

async fn fs_upload_inner(
    app: AppHandle,
    container_id: String,
    dest_dir: String,
) -> Result<serde_json::Value, String> {
    let container_id = container_id.trim().to_string();
    if container_id.is_empty() {
        return Err("containerId is required".into());
    }
    let dest = normalize_container_path(&dest_dir)?;
    let files = pick_open_many(&app, "Upload to container").await?;
    if files.is_empty() {
        return Err("cancelled".into());
    }
    let d = get_docker()?;
    let mut uploaded: Vec<String> = Vec::new();
    for fp in files {
        let body = tokio::fs::read(&fp).await.map_err(|e| e.to_string())?;
        if body.len() > CONTAINER_FS_MAX_READ_BYTES {
            let name = fp.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            return Err(format!("{name} exceeds {CONTAINER_FS_MAX_READ_BYTES} bytes"));
        }
        let name = fp.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let tar = pack_single_file(&name, &body)?;
        d.upload_to_container(
            &container_id,
            Some(UploadToContainerOptions {
                path: dest.clone(),
                ..Default::default()
            }),
            Bytes::from(tar),
        )
        .await
        .map_err(|e| e.to_string())?;
        uploaded.push(name);
    }
    Ok(json!({ "files": uploaded }))
}

#[tauri::command]
pub async fn docker_fs_upload(
    app: AppHandle,
    container_id: String,
    dest_dir: String,
) -> IpcResult<serde_json::Value> {
    into_ipc(fs_upload_inner(app, container_id, dest_dir).await)
}
