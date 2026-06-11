//! Tauri 应用入口。run() 注册插件与命令，随迁移阶段逐步扩充命令表。

mod app;
mod channels;
mod docker;
mod ipc;

use tauri::Manager;

pub fn run() {
    tauri::Builder::default()
        // 单实例：第二次启动时聚焦已有主窗口（替代 Electron 的 requestSingleInstanceLock）
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_focus();
                let _ = w.unminimize();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            // 安装应用菜单（主题/语言/帮助）
            let _ = app::menu::install_menu(app.handle());
            Ok(())
        })
        .on_menu_event(|app, event| {
            app::menu::handle_menu_event(app, event.id().as_ref());
        })
        .invoke_handler(tauri::generate_handler![
            // 连通性 / 系统
            docker::docker_ping,
            docker::docker_info,
            docker::docker_version,
            docker::docker_df,
            docker::docker_reconnect,
            // 容器
            docker::containers::docker_list_containers,
            docker::containers::docker_inspect_container,
            docker::containers::docker_start_container,
            docker::containers::docker_stop_container,
            docker::containers::docker_restart_container,
            docker::containers::docker_kill_container,
            docker::containers::docker_pause_container,
            docker::containers::docker_unpause_container,
            docker::containers::docker_remove_container,
            docker::containers::docker_container_stats_once,
            docker::containers::docker_running_mem_summary,
            docker::containers::docker_containers_mem_usage,
            // 镜像
            docker::images::docker_list_images,
            docker::images::docker_inspect_image,
            docker::images::docker_remove_image,
            docker::images::docker_pull_image,
            docker::images::docker_tag_image,
            docker::images::docker_image_history,
            // 网络
            docker::networks::docker_list_networks,
            docker::networks::docker_remove_network,
            docker::networks::docker_create_network,
            docker::networks::docker_network_connect,
            docker::networks::docker_network_disconnect,
            // 卷
            docker::volumes::docker_list_volumes,
            docker::volumes::docker_remove_volume,
            docker::volumes::docker_create_volume,
            docker::volumes::docker_volume_used_by,
            // 流式：日志 / 事件
            docker::logs::docker_logs_start,
            docker::logs::docker_logs_stop,
            docker::events::docker_events_start,
            docker::events::docker_events_stop,
            // exec：一次性 / 取消 / 交互式 PTY
            docker::exec_once::docker_exec_once,
            docker::exec_once::docker_exec_cancel,
            docker::exec_pty::docker_exec_pty_start,
            docker::exec_pty::docker_exec_pty_stop,
            docker::exec_pty::docker_exec_pty_write,
            docker::exec_pty::docker_exec_pty_resize,
            // CLI 编排
            docker::cli::docker_create_from_cli,
            docker::cli::docker_build_dockerfile,
            docker::cli::docker_compose_up,
            // 创建 / 重建 / 调参 / 提交
            docker::create::docker_create_run_container,
            docker::create::docker_recreate_container,
            docker::create::docker_patch_runtime,
            docker::create::docker_commit_container,
            // 容器文件系统
            docker::container_fs::docker_fs_list,
            docker::container_fs::docker_fs_read,
            docker::container_fs::docker_fs_write,
            docker::container_fs::docker_fs_rm,
            docker::container_fs::docker_fs_mkdir,
            // 应用壳层：运行时环境 / 指标 / 引擎 / 打开
            app::shell::app_docker_runtime_env,
            app::shell::app_open_path,
            app::shell::docker_open_docs,
            app::shell::app_host_metrics,
            app::shell::app_compose_version,
            app::shell::app_docker_bootstrap_status,
            app::shell::app_start_engine,
            app::shell::app_stop_engine,
            // 窗口
            app::windows::app_open_logs_window,
            app::windows::app_open_exec_window,
            app::windows::app_open_files_window,
            // 文件对话框
            app::dialogs::docker_save_image_tar,
            app::dialogs::docker_load_image_tar,
            app::dialogs::docker_export_container_tar,
            app::dialogs::docker_fs_download,
            app::dialogs::docker_fs_upload,
            // 菜单同步
            app::menu::app_set_theme_pref,
            app::menu::app_set_language,
            // 更新
            app::updater::app_get_version,
            app::updater::app_check_updates,
            app::updater::app_quit_install,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, event| {
            // 退出时静默清理流订阅与 PTY 会话（对齐 Electron before-quit）
            if let tauri::RunEvent::Exit = event {
                docker::logs::abort_all();
                docker::events::abort_all();
                docker::exec_pty::kill_all_pty();
            }
        });
}
