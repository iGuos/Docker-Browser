mod commands;
mod docker_client;
mod docker_path;
mod error;
mod pty_session;
mod stream_sub;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // App
            commands::app::get_app_version,
            commands::app::get_docker_runtime_env,
            commands::app::get_docker_bootstrap_status,
            commands::app::start_docker_engine,
            commands::app::stop_docker_engine,
            commands::app::get_host_metrics,
            commands::app::get_compose_version,
            commands::app::open_path,
            // Docker basic
            commands::docker::ping,
            commands::docker::info,
            commands::docker::version,
            commands::docker::df,
            commands::docker::reconnect_docker,
            // Containers
            commands::containers::list_containers,
            commands::containers::inspect_container,
            commands::containers::start_container,
            commands::containers::stop_container,
            commands::containers::restart_container,
            commands::containers::kill_container,
            commands::containers::pause_container,
            commands::containers::unpause_container,
            commands::containers::remove_container,
            commands::containers::create_run_container,
            commands::containers::recreate_container,
            commands::containers::patch_container_runtime,
            commands::containers::exec_once,
            commands::containers::container_stats_once,
            commands::containers::containers_memory_usage,
            commands::containers::running_containers_memory_summary,
            commands::containers::commit_container,
            commands::containers::export_container_tar,
            // Images
            commands::images::list_images,
            commands::images::inspect_image,
            commands::images::remove_image,
            commands::images::pull_image,
            commands::images::tag_image,
            commands::images::image_history,
            commands::images::save_image_tar,
            commands::images::load_image_tar,
            // Networks
            commands::networks::list_networks,
            commands::networks::remove_network,
            commands::networks::create_network,
            commands::networks::network_connect,
            commands::networks::network_disconnect,
            // Volumes
            commands::volumes::list_volumes,
            commands::volumes::remove_volume,
            commands::volumes::create_volume,
            commands::volumes::volume_used_by,
            // Logs & Events (streaming)
            commands::streams::logs_start,
            commands::streams::logs_stop,
            commands::streams::events_start,
            commands::streams::events_stop,
            // Exec PTY
            commands::pty::exec_pty_start,
            commands::pty::exec_pty_stop,
            commands::pty::exec_pty_write,
            commands::pty::exec_pty_resize,
            // Container filesystem
            commands::container_fs::container_fs_list,
            commands::container_fs::container_fs_read_file,
            commands::container_fs::container_fs_write_file,
            commands::container_fs::container_fs_rm,
            commands::container_fs::container_fs_mkdir,
            commands::container_fs::container_fs_download,
            commands::container_fs::container_fs_upload,
            // Docker CLI wrappers
            commands::docker_cli::create_and_restart_from_docker_run_cli,
            commands::docker_cli::build_and_run_from_dockerfile,
            commands::docker_cli::compose_up_from_yaml,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
