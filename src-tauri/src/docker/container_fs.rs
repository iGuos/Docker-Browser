//! 容器文件系统：list（运行中走 exec ls/stat，否则 getArchive tar 解析）、read/write（tar+base64）、rm/mkdir（exec）。
//! 对齐 containerFs.ts 与 ipcDocker.ts 的 container-fs-* handler。download/upload（文件对话框）见 P6。

use super::client::get_docker;
use crate::ipc::{into_ipc, IpcResult};
use base64::{engine::general_purpose::STANDARD, Engine};
use bollard::container::{DownloadFromContainerOptions, LogOutput, UploadToContainerOptions};
use bollard::exec::{CreateExecOptions, StartExecResults};
use bollard::Docker;
use bytes::Bytes;
use futures_util::stream::StreamExt;
use serde::Serialize;
use serde_json::json;
use std::io::Read;

pub const CONTAINER_FS_MAX_READ_BYTES: usize = 512 * 1024;

#[derive(Serialize)]
pub struct TarListEntry {
    name: String,
    #[serde(rename = "type")]
    kind: &'static str,
    size: u64,
    mode: String,
    nlink: u64,
    user: String,
    group: String,
    mtime: i64,
}

/// 规范化容器内 POSIX 路径：确保以 / 开头、解析 . 与 ..、拒绝非法路径。
pub fn normalize_container_path(p: &str) -> Result<String, String> {
    let s = p.trim();
    let s = if s.is_empty() { "/" } else { s };
    if s.contains('\0') {
        return Err("invalid path".into());
    }
    let with_root = if s.starts_with('/') {
        s.to_string()
    } else {
        format!("/{s}")
    };
    let mut stack: Vec<&str> = Vec::new();
    for seg in with_root.split('/') {
        match seg {
            "" | "." => {}
            ".." => {
                if stack.pop().is_none() {
                    return Err("invalid path".into());
                }
            }
            other => stack.push(other),
        }
    }
    Ok(if stack.is_empty() {
        "/".to_string()
    } else {
        format!("/{}", stack.join("/"))
    })
}

fn posix_dirname(p: &str) -> String {
    match p.rsplit_once('/') {
        Some(("", _)) => "/".to_string(),
        Some((parent, _)) => parent.to_string(),
        None => "/".to_string(),
    }
}

pub fn posix_basename(p: &str) -> &str {
    p.rsplit('/').next().unwrap_or(p)
}

// ---- exec 辅助 ----

/// 在容器内执行 argv，返回 (合并 stdout+stderr, exit_code)。
async fn container_exec_argv(
    d: &Docker,
    container_id: &str,
    argv: Vec<String>,
) -> Result<(String, Option<i64>), String> {
    let exec = d
        .create_exec(
            container_id,
            CreateExecOptions {
                cmd: Some(argv),
                attach_stdout: Some(true),
                attach_stderr: Some(true),
                ..Default::default()
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    let mut out = Vec::<u8>::new();
    if let StartExecResults::Attached { mut output, .. } =
        d.start_exec(&exec.id, None).await.map_err(|e| e.to_string())?
    {
        while let Some(item) = output.next().await {
            match item {
                Ok(LogOutput::StdOut { message })
                | Ok(LogOutput::StdErr { message })
                | Ok(LogOutput::StdIn { message })
                | Ok(LogOutput::Console { message }) => out.extend_from_slice(&message),
                Err(e) => return Err(e.to_string()),
            }
        }
    }
    let ins = d.inspect_exec(&exec.id).await.map_err(|e| e.to_string())?;
    Ok((String::from_utf8_lossy(&out).to_string(), ins.exit_code))
}

// ---- 列目录 ----

const LIST_DIR_SCRIPT: &str = r#"cd "$1" || exit 1
ls -1A 2>/dev/null | while IFS= read -r name || [ -n "$name" ]; do
  [ -z "$name" ] && continue
  case "$name" in .|..) continue ;; esac
  if [ -d "$name" ] && [ ! -L "$name" ]; then
    typ=d
  else
    typ=f
  fi
  st=$(stat -c '%A|%h|%U|%G|%s|%Y' "$name" 2>/dev/null) || continue
  printf '%s|%s|%s\n' "$typ" "$st" "$name"
done"#;

/// 解析 LIST_DIR_SCRIPT 输出：每行 `typ|mode|nlink|user|group|size|mtime|name`（name 可含 |）。
fn parse_list_dir_output(output: &str) -> Vec<TarListEntry> {
    let mut entries = Vec::new();
    for line in output.lines() {
        if line.is_empty() {
            continue;
        }
        let parts: Vec<&str> = line.split('|').collect();
        if parts.len() < 8 {
            continue;
        }
        let type_char = parts[0];
        if type_char != "d" && type_char != "f" {
            continue;
        }
        let name = parts[7..].join("|");
        if name.is_empty() {
            continue;
        }
        let is_dir = type_char == "d";
        entries.push(TarListEntry {
            name,
            kind: if is_dir { "directory" } else { "file" },
            size: if is_dir {
                0
            } else {
                parts[5].parse::<u64>().unwrap_or(0)
            },
            mode: if parts[1].is_empty() { "----------".into() } else { parts[1].to_string() },
            nlink: parts[2].parse::<u64>().unwrap_or(1).max(0),
            user: if parts[3].is_empty() { "-".into() } else { parts[3].to_string() },
            group: if parts[4].is_empty() { "-".into() } else { parts[4].to_string() },
            mtime: parts[6].parse::<i64>().unwrap_or(0),
        });
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    entries
}

fn rwx(bits: u32) -> String {
    format!(
        "{}{}{}",
        if bits & 4 != 0 { "r" } else { "-" },
        if bits & 2 != 0 { "w" } else { "-" },
        if bits & 1 != 0 { "x" } else { "-" }
    )
}

/// 由 tar 条目类型 + mode 生成类似 ls -l 的 10 字符权限串。
fn mode_to_ls(mode: u32, is_dir: bool, is_symlink: bool) -> String {
    let perm = mode & 0o777;
    let tc = if is_dir {
        'd'
    } else if is_symlink {
        'l'
    } else {
        '-'
    };
    format!(
        "{}{}{}{}",
        tc,
        rwx((perm >> 6) & 7),
        rwx((perm >> 3) & 7),
        rwx(perm & 7)
    )
}

async fn collect_archive(d: &Docker, container_id: &str, path: &str) -> Result<Vec<u8>, String> {
    let mut stream =
        d.download_from_container(container_id, Some(DownloadFromContainerOptions { path }));
    let mut buf = Vec::new();
    while let Some(chunk) = stream.next().await {
        buf.extend_from_slice(&chunk.map_err(|e| e.to_string())?);
    }
    Ok(buf)
}

/// 已停止容器：解析 getArchive 的 tar，得到第一层条目。
fn parse_tar_first_level(buf: &[u8]) -> Result<Vec<TarListEntry>, String> {
    let mut ar = tar::Archive::new(std::io::Cursor::new(buf));
    let mut entries: Vec<TarListEntry> = Vec::new();
    for e in ar.entries().map_err(|e| e.to_string())? {
        let e = e.map_err(|e| e.to_string())?;
        let header = e.header();
        let path = header
            .path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();
        let mut n = path.trim_start_matches("./").trim_end_matches('/').to_string();
        if n.is_empty() || n == "." || n == ".." {
            continue;
        }
        if let Some(slash) = n.find('/') {
            n.truncate(slash);
        }
        if entries.iter().any(|x| x.name == n) {
            continue;
        }
        let et = header.entry_type();
        let is_dir = et.is_dir();
        let mode = header.mode().unwrap_or(0);
        entries.push(TarListEntry {
            name: n,
            kind: if is_dir { "directory" } else { "file" },
            size: if is_dir { 0 } else { header.size().unwrap_or(0) },
            mode: mode_to_ls(mode, is_dir, et.is_symlink()),
            nlink: 1,
            user: header.username().ok().flatten().map(|s| s.to_string()).unwrap_or_default(),
            group: header.groupname().ok().flatten().map(|s| s.to_string()).unwrap_or_default(),
            mtime: header.mtime().unwrap_or(0) as i64,
        });
    }
    entries.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(entries)
}

async fn list_inner(container_id: String, path: Option<String>) -> Result<serde_json::Value, String> {
    let container_id = container_id.trim().to_string();
    if container_id.is_empty() {
        return Err("containerId is required".into());
    }
    let dir = normalize_container_path(path.as_deref().unwrap_or("/"))?;
    let d = get_docker()?;
    let ins = d.inspect_container(&container_id, None).await.map_err(|e| e.to_string())?;
    let running = serde_json::to_value(&ins)
        .ok()
        .and_then(|v| v.get("State").and_then(|s| s.get("Running")).and_then(|r| r.as_bool()))
        .unwrap_or(false);

    if running {
        let argv = vec![
            "sh".to_string(),
            "-c".to_string(),
            LIST_DIR_SCRIPT.to_string(),
            "sh".to_string(),
            dir.clone(),
        ];
        if let Ok((output, exit)) = container_exec_argv(&d, &container_id, argv).await {
            if exit == Some(0) || exit.is_none() {
                return Ok(json!({ "entries": parse_list_dir_output(&output) }));
            }
        }
        // exec 不可用时回退到 getArchive
    }
    let buf = collect_archive(&d, &container_id, &dir).await?;
    Ok(json!({ "entries": parse_tar_first_level(&buf)? }))
}

#[tauri::command]
pub async fn docker_fs_list(
    container_id: String,
    path: Option<String>,
) -> IpcResult<serde_json::Value> {
    into_ipc(list_inner(container_id, path).await)
}

// ---- 读文件 ----

/// 从 tar 取第一个普通文件内容，超过上限报错。
fn extract_first_file(buf: &[u8], max: usize) -> Result<Vec<u8>, String> {
    let mut ar = tar::Archive::new(std::io::Cursor::new(buf));
    for e in ar.entries().map_err(|e| e.to_string())? {
        let mut e = e.map_err(|e| e.to_string())?;
        if e.header().entry_type().is_dir() {
            continue;
        }
        let size = e.header().size().unwrap_or(0) as usize;
        if size > max {
            return Err(format!("file exceeds {max} bytes"));
        }
        let mut data = Vec::with_capacity(size);
        e.read_to_end(&mut data).map_err(|e| e.to_string())?;
        if data.len() > max {
            return Err(format!("file exceeds {max} bytes"));
        }
        return Ok(data);
    }
    Err("no file in archive".into())
}

async fn read_inner(container_id: String, path: String) -> Result<serde_json::Value, String> {
    let container_id = container_id.trim().to_string();
    if container_id.is_empty() {
        return Err("containerId is required".into());
    }
    if path.trim().is_empty() {
        return Err("path is required".into());
    }
    let file_path = normalize_container_path(&path)?;
    let d = get_docker()?;
    let buf = collect_archive(&d, &container_id, &file_path).await?;
    let body = extract_first_file(&buf, CONTAINER_FS_MAX_READ_BYTES)?;
    Ok(json!({ "base64": STANDARD.encode(&body) }))
}

#[tauri::command]
pub async fn docker_fs_read(container_id: String, path: String) -> IpcResult<serde_json::Value> {
    into_ipc(read_inner(container_id, path).await)
}

// ---- 写文件 ----

/// 用单文件构造 tar（条目名 = basename）。
pub fn pack_single_file(name: &str, body: &[u8]) -> Result<Vec<u8>, String> {
    let mut builder = tar::Builder::new(Vec::new());
    let mut header = tar::Header::new_gnu();
    header.set_size(body.len() as u64);
    header.set_mode(0o644);
    header.set_cksum();
    builder.append_data(&mut header, name, body).map_err(|e| e.to_string())?;
    builder.into_inner().map_err(|e| e.to_string())
}

async fn write_inner(container_id: String, path: String, base64: String) -> Result<(), String> {
    let container_id = container_id.trim().to_string();
    if container_id.is_empty() {
        return Err("containerId is required".into());
    }
    if path.trim().is_empty() {
        return Err("path is required".into());
    }
    let file_path = normalize_container_path(&path)?;
    let body = STANDARD.decode(base64.as_bytes()).map_err(|_| "invalid base64".to_string())?;
    if body.len() > CONTAINER_FS_MAX_READ_BYTES {
        return Err(format!("file exceeds {CONTAINER_FS_MAX_READ_BYTES} bytes"));
    }
    let parent = posix_dirname(&file_path);
    let base = posix_basename(&file_path);
    if base.is_empty() || base == "." || base == ".." {
        return Err("invalid file path".into());
    }
    let tar = pack_single_file(base, &body)?;
    let d = get_docker()?;
    let parent = if parent.is_empty() { "/".to_string() } else { parent };
    d.upload_to_container(
        &container_id,
        Some(UploadToContainerOptions {
            path: parent,
            ..Default::default()
        }),
        Bytes::from(tar),
    )
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn docker_fs_write(
    container_id: String,
    path: String,
    base64: String,
) -> IpcResult<()> {
    into_ipc(write_inner(container_id, path, base64).await)
}

// ---- rm / mkdir（exec）----

async fn rm_inner(container_id: String, path: String) -> Result<(), String> {
    let container_id = container_id.trim().to_string();
    if container_id.is_empty() {
        return Err("containerId is required".into());
    }
    if path.trim().is_empty() {
        return Err("path is required".into());
    }
    let target = normalize_container_path(&path)?;
    if target == "/" {
        return Err("refusing to remove root".into());
    }
    let d = get_docker()?;
    let (output, exit) =
        container_exec_argv(&d, &container_id, vec!["rm".into(), "-rf".into(), target]).await?;
    if let Some(code) = exit {
        if code != 0 {
            return Err(if output.trim().is_empty() {
                format!("rm failed (exit {code})")
            } else {
                output.trim().to_string()
            });
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn docker_fs_rm(container_id: String, path: String) -> IpcResult<()> {
    into_ipc(rm_inner(container_id, path).await)
}

async fn mkdir_inner(container_id: String, path: String) -> Result<(), String> {
    let container_id = container_id.trim().to_string();
    if container_id.is_empty() {
        return Err("containerId is required".into());
    }
    if path.trim().is_empty() {
        return Err("path is required".into());
    }
    let dir = normalize_container_path(&path)?;
    let d = get_docker()?;
    let (output, exit) =
        container_exec_argv(&d, &container_id, vec!["mkdir".into(), "-p".into(), dir]).await?;
    if let Some(code) = exit {
        if code != 0 {
            return Err(if output.trim().is_empty() {
                format!("mkdir failed (exit {code})")
            } else {
                output.trim().to_string()
            });
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn docker_fs_mkdir(container_id: String, path: String) -> IpcResult<()> {
    into_ipc(mkdir_inner(container_id, path).await)
}
