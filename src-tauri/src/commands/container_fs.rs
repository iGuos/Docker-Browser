use crate::docker_client::get_docker;
use crate::error::Result;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use bollard::exec::{CreateExecOptions, StartExecResults};
use futures_util::StreamExt;
use serde::Serialize;
use std::io::{Cursor, Read};
use tar::Archive;

const MAX_READ_BYTES: usize = 512 * 1024;

#[derive(Serialize)]
pub struct FsEntry {
    pub name: String,
    #[serde(rename = "type")]
    pub entry_type: String,
    pub size: u64,
}

#[derive(Serialize)]
pub struct FsListResult {
    pub entries: Vec<FsEntry>,
}

fn normalize_path(p: &str) -> Result<String> {
    let s = p.trim();
    let s = if s.is_empty() { "/" } else { s };
    let s = if s.starts_with('/') { s.to_string() } else { format!("/{s}") };
    if s.contains('\0') {
        return Err(crate::error::AppError("invalid path".into()));
    }
    Ok(s)
}

async fn list_via_archive(container_id: &str, path: &str) -> Result<Vec<FsEntry>> {
    let path = normalize_path(path)?;
    let mut stream = get_docker().download_from_container(
        container_id,
        Some(bollard::container::DownloadFromContainerOptions { path: path.as_str() }),
    );
    let mut buf = Vec::new();
    while let Some(chunk) = stream.next().await {
        buf.extend_from_slice(&chunk?);
    }
    let mut archive = Archive::new(Cursor::new(&buf));
    let mut entries = Vec::new();
    for entry in archive.entries().map_err(|e| crate::error::AppError(e.to_string()))? {
        let entry = entry.map_err(|e| crate::error::AppError(e.to_string()))?;
        let header = entry.header();
        let entry_path = entry.path().map_err(|e| crate::error::AppError(e.to_string()))?;
        let name = entry_path.file_name().and_then(|n| n.to_str()).unwrap_or("").to_string();
        if name.is_empty() || name == "." { continue; }
        let entry_type = match header.entry_type() {
            tar::EntryType::Directory => "directory",
            _ => "file",
        }.to_string();
        let size = header.size().unwrap_or(0);
        entries.push(FsEntry { name, entry_type, size });
    }
    Ok(entries)
}

async fn list_via_exec(container_id: &str, path: &str) -> Result<Vec<FsEntry>> {
    let path = normalize_path(path)?;
    let script = format!(
        r#"ls -1a "{path}" 2>/dev/null | while read f; do
  fp="{path}/$f"
  if [ "$f" = "." ] || [ "$f" = ".." ]; then continue; fi
  if [ -d "$fp" ]; then echo "directory\t0\t$f"
  else echo "file\t$(stat -c %s "$fp" 2>/dev/null || echo 0)\t$f"
  fi
done"#
    );
    let exec = get_docker()
        .create_exec(container_id, CreateExecOptions {
            cmd: Some(vec!["sh", "-c", &script]),
            attach_stdout: Some(true),
            attach_stderr: Some(false),
            ..Default::default()
        })
        .await?;
    let mut output_text = String::new();
    if let StartExecResults::Attached { mut output, .. } =
        get_docker().start_exec(&exec.id, None).await?
    {
        while let Some(Ok(chunk)) = output.next().await {
            use bollard::container::LogOutput;
            if let LogOutput::StdOut { message } = chunk {
                output_text.push_str(&String::from_utf8_lossy(&message));
            }
        }
    }
    let entries = output_text.lines().filter_map(|line| {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() < 3 { return None; }
        Some(FsEntry {
            entry_type: parts[0].to_string(),
            size: parts[1].parse().unwrap_or(0),
            name: parts[2].to_string(),
        })
    }).collect();
    Ok(entries)
}

#[tauri::command]
pub async fn container_fs_list(container_id: String, path: String) -> Result<FsListResult> {
    match list_via_exec(&container_id, &path).await {
        Ok(entries) => Ok(FsListResult { entries }),
        Err(_) => Ok(FsListResult { entries: list_via_archive(&container_id, &path).await? }),
    }
}

#[derive(Serialize)]
pub struct ReadFileResult {
    pub base64: String,
}

#[tauri::command]
pub async fn container_fs_read_file(container_id: String, path: String) -> Result<ReadFileResult> {
    let path = normalize_path(&path)?;
    let mut stream = get_docker().download_from_container(
        &container_id,
        Some(bollard::container::DownloadFromContainerOptions { path: path.as_str() }),
    );
    let mut buf = Vec::new();
    while let Some(chunk) = stream.next().await {
        buf.extend_from_slice(&chunk?);
        if buf.len() > MAX_READ_BYTES + 65536 { break; }
    }
    let mut archive = Archive::new(Cursor::new(&buf));
    let mut content = Vec::new();
    for entry in archive.entries().map_err(|e| crate::error::AppError(e.to_string()))? {
        let mut entry = entry.map_err(|e| crate::error::AppError(e.to_string()))?;
        if entry.header().entry_type().is_file() {
            entry.read_to_end(&mut content).map_err(|e| crate::error::AppError(e.to_string()))?;
            break;
        }
    }
    if content.len() > MAX_READ_BYTES {
        return Err(crate::error::AppError("file too large".into()));
    }
    Ok(ReadFileResult { base64: BASE64.encode(&content) })
}

#[tauri::command]
pub async fn container_fs_write_file(container_id: String, path: String, base64: String) -> Result<()> {
    let path = normalize_path(&path)?;
    let content = BASE64.decode(&base64).map_err(|e| crate::error::AppError(e.to_string()))?;
    let file_name = std::path::Path::new(&path).file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string();
    let dir = std::path::Path::new(&path).parent().and_then(|p| p.to_str()).unwrap_or("/").to_string();
    let tar_bytes = pack_single_file(&file_name, &content)?;
    get_docker().upload_to_container(
        &container_id,
        Some(bollard::container::UploadToContainerOptions { path: dir.as_str(), ..Default::default() }),
        tar_bytes.into(),
    ).await?;
    Ok(())
}

#[tauri::command]
pub async fn container_fs_rm(container_id: String, path: String) -> Result<()> {
    let path = normalize_path(&path)?;
    let exec = get_docker().create_exec(&container_id, CreateExecOptions {
        cmd: Some(vec!["rm", "-rf", &path]),
        attach_stdout: Some(false),
        attach_stderr: Some(false),
        ..Default::default()
    }).await?;
    get_docker().start_exec(&exec.id, None).await?;
    Ok(())
}

#[tauri::command]
pub async fn container_fs_mkdir(container_id: String, path: String) -> Result<()> {
    let path = normalize_path(&path)?;
    let exec = get_docker().create_exec(&container_id, CreateExecOptions {
        cmd: Some(vec!["mkdir", "-p", &path]),
        attach_stdout: Some(false),
        attach_stderr: Some(false),
        ..Default::default()
    }).await?;
    get_docker().start_exec(&exec.id, None).await?;
    Ok(())
}

#[derive(Serialize)]
pub struct FilePathResult {
    #[serde(rename = "filePath")]
    pub file_path: String,
}

#[tauri::command]
pub async fn container_fs_download(
    app: tauri::AppHandle,
    container_id: String,
    path: String,
) -> Result<FilePathResult> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::io::AsyncWriteExt;

    let path = normalize_path(&path)?;
    let file_name = std::path::Path::new(&path).file_name().and_then(|n| n.to_str()).unwrap_or("archive").to_string();

    let save_path = app.dialog().file()
        .set_title("Download from Container")
        .set_file_name(&format!("{file_name}.tar"))
        .blocking_save_file()
        .ok_or_else(|| crate::error::AppError("cancelled".into()))?;

    let path_str = save_path.into_path()
        .map_err(|_| crate::error::AppError("invalid path".into()))?
        .to_string_lossy().to_string();

    let mut stream = get_docker().download_from_container(
        &container_id,
        Some(bollard::container::DownloadFromContainerOptions { path: path.as_str() }),
    );
    let mut file = tokio::fs::File::create(&path_str).await?;
    while let Some(chunk) = stream.next().await {
        file.write_all(&chunk?).await?;
    }
    Ok(FilePathResult { file_path: path_str })
}

#[derive(Serialize)]
pub struct UploadResult {
    pub files: Vec<String>,
}

#[tauri::command]
pub async fn container_fs_upload(
    app: tauri::AppHandle,
    container_id: String,
    dest_dir: String,
) -> Result<UploadResult> {
    use tauri_plugin_dialog::DialogExt;

    let dest_dir = normalize_path(&dest_dir)?;
    let file_paths = app.dialog().file()
        .set_title("Upload to Container")
        .blocking_pick_files()
        .ok_or_else(|| crate::error::AppError("cancelled".into()))?;

    let mut uploaded = Vec::new();
    for fp in file_paths {
        let path_buf = fp.into_path().map_err(|_| crate::error::AppError("invalid path".into()))?;
        let file_name = path_buf.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string();
        let content: Vec<u8> = tokio::fs::read(&path_buf).await?;
        let tar_bytes = pack_single_file(&file_name, &content)?;
        get_docker().upload_to_container(
            &container_id,
            Some(bollard::container::UploadToContainerOptions { path: dest_dir.as_str(), ..Default::default() }),
            tar_bytes.into(),
        ).await?;
        uploaded.push(file_name);
    }
    Ok(UploadResult { files: uploaded })
}

fn pack_single_file(name: &str, content: &[u8]) -> Result<Vec<u8>> {
    let mut tar_buf = Vec::new();
    {
        let mut builder = tar::Builder::new(&mut tar_buf);
        let mut header = tar::Header::new_gnu();
        header.set_size(content.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder.append_data(&mut header, name, content).map_err(|e| crate::error::AppError(e.to_string()))?;
        builder.finish().map_err(|e| crate::error::AppError(e.to_string()))?;
    }
    Ok(tar_buf)
}
