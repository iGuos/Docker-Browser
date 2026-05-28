use crate::docker_client::get_docker;
use crate::error::Result;
use bollard::image::{CreateImageOptions, ImportImageOptions, ListImagesOptions, RemoveImageOptions};
use bytes::Bytes;
use futures_util::StreamExt;
use serde_json::Value;

#[tauri::command]
pub async fn list_images() -> Result<Vec<Value>> {
    let list = get_docker()
        .list_images(Some(ListImagesOptions::<String> {
            all: false,
            ..Default::default()
        }))
        .await?;
    Ok(list
        .into_iter()
        .map(|i| serde_json::to_value(i).unwrap_or(Value::Null))
        .collect())
}

#[tauri::command]
pub async fn inspect_image(name: String) -> Result<Value> {
    let info = get_docker().inspect_image(&name).await?;
    Ok(serde_json::to_value(info).unwrap_or(Value::Null))
}

#[tauri::command]
pub async fn remove_image(name: String, force: Option<bool>, noprune: Option<bool>) -> Result<Vec<Value>> {
    let resp = get_docker()
        .remove_image(
            &name,
            Some(RemoveImageOptions {
                force: force.unwrap_or(false),
                noprune: noprune.unwrap_or(false),
            }),
            None,
        )
        .await?;
    Ok(resp
        .into_iter()
        .map(|r| serde_json::to_value(r).unwrap_or(Value::Null))
        .collect())
}

#[tauri::command]
pub async fn pull_image(repo_tag: String) -> Result<()> {
    let (image, tag) = if let Some((img, t)) = repo_tag.rsplit_once(':') {
        (img.to_string(), t.to_string())
    } else {
        (repo_tag, "latest".to_string())
    };
    let mut stream = get_docker().create_image(
        Some(CreateImageOptions {
            from_image: image,
            tag,
            ..Default::default()
        }),
        None,
        None,
    );
    while let Some(item) = stream.next().await {
        item?;
    }
    Ok(())
}

#[tauri::command]
pub async fn tag_image(source: String, repo: String, tag: Option<String>) -> Result<()> {
    use bollard::image::TagImageOptions;
    get_docker()
        .tag_image(
            &source,
            Some(TagImageOptions {
                repo: repo.as_str(),
                tag: tag.as_deref().unwrap_or("latest"),
            }),
        )
        .await?;
    Ok(())
}

#[tauri::command]
pub async fn image_history(name: String) -> Result<Vec<Value>> {
    let history = get_docker().image_history(&name).await?;
    Ok(history
        .into_iter()
        .map(|h| serde_json::to_value(h).unwrap_or(Value::Null))
        .collect())
}

#[tauri::command]
pub async fn save_image_tar(app: tauri::AppHandle, name: String) -> Result<super::containers::FilePathResult> {
    use tauri_plugin_dialog::DialogExt;
    use tokio::io::AsyncWriteExt;

    let safe_name = name.replace('/', "_").replace(':', "_");
    let default_name = format!("{safe_name}.tar");

    let file_path = app
        .dialog()
        .file()
        .set_title("Save Image")
        .set_file_name(&default_name)
        .blocking_save_file()
        .ok_or_else(|| crate::error::AppError("cancelled".into()))?;

    let path_buf = file_path
        .into_path()
        .map_err(|_| crate::error::AppError("invalid path".into()))?;
    let path_str = path_buf.to_string_lossy().to_string();

    let mut stream = get_docker().export_image(&name);
    let mut file = tokio::fs::File::create(&path_str).await?;
    while let Some(chunk) = stream.next().await {
        file.write_all(&chunk?).await?;
    }

    Ok(super::containers::FilePathResult { file_path: path_str })
}

#[tauri::command]
pub async fn load_image_tar(app: tauri::AppHandle) -> Result<()> {
    use tauri_plugin_dialog::DialogExt;

    let file_path = app
        .dialog()
        .file()
        .set_title("Load Image")
        .blocking_pick_file()
        .ok_or_else(|| crate::error::AppError("cancelled".into()))?;

    let path_buf = file_path
        .into_path()
        .map_err(|_| crate::error::AppError("invalid path".into()))?;

    let data: Vec<u8> = tokio::fs::read(&path_buf).await?;
    let mut stream = get_docker().import_image(
        ImportImageOptions { quiet: false },
        Bytes::from(data),
        None,
    );
    while let Some(item) = stream.next().await {
        item?;
    }
    Ok(())
}
