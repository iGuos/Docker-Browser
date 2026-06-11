//! 应用菜单：外观(主题) / 语言 单选，帮助菜单。主题/语言切换通过 app-menu:theme /
//! app-menu:language 事件广播给渲染进程（对齐 appMenu.ts）。渲染进程也会通过
//! app_set_theme_pref / app_set_language 反向同步菜单勾选态。

use crate::channels;
use crate::ipc::IpcResult;
use std::sync::{Mutex, OnceLock};
use tauri::menu::{CheckMenuItemBuilder, MenuBuilder, PredefinedMenuItem, SubmenuBuilder};
use tauri::{AppHandle, Emitter, Runtime};
use tauri_plugin_opener::OpenerExt;

const REPO_URL: &str = "https://github.com/unicorngithub/Docker-Browser";
const DOCS_URL: &str = "https://docs.docker.com/engine/api/latest/";

/// (themePref, language)
fn state() -> &'static Mutex<(String, String)> {
    static S: OnceLock<Mutex<(String, String)>> = OnceLock::new();
    S.get_or_init(|| Mutex::new(("system".to_string(), "en".to_string())))
}

fn current() -> (String, String) {
    state().lock().map(|g| g.clone()).unwrap_or(("system".into(), "en".into()))
}

/// 构建并安装应用菜单（反映当前主题/语言勾选）。
pub fn install_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let (theme, lang) = current();

    let appearance = SubmenuBuilder::new(app, "Appearance")
        .item(&CheckMenuItemBuilder::with_id("theme:light", "Light").checked(theme == "light").build(app)?)
        .item(&CheckMenuItemBuilder::with_id("theme:dark", "Dark").checked(theme == "dark").build(app)?)
        .item(&CheckMenuItemBuilder::with_id("theme:system", "System").checked(theme == "system").build(app)?)
        .build()?;

    let language = SubmenuBuilder::new(app, "Language")
        .item(&CheckMenuItemBuilder::with_id("lang:en", "English").checked(lang == "en").build(app)?)
        .item(&CheckMenuItemBuilder::with_id("lang:zh-CN", "简体中文").checked(lang == "zh-CN").build(app)?)
        .build()?;

    let settings = SubmenuBuilder::new(app, "Settings").item(&appearance).item(&language).build()?;

    let edit = SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()?;

    let view = SubmenuBuilder::new(app, "View")
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;

    let help = SubmenuBuilder::new(app, "Help")
        .text("help:docs", "Docker Engine Docs")
        .text("help:repo", "Open Source Repository")
        .build()?;

    let mut builder = MenuBuilder::new(app);
    // macOS 应用菜单（关于 / 退出）
    #[cfg(target_os = "macos")]
    {
        let app_menu = SubmenuBuilder::new(app, "Docker Browser")
            .item(&PredefinedMenuItem::about(app, None, None)?)
            .separator()
            .item(&PredefinedMenuItem::hide(app, None)?)
            .item(&PredefinedMenuItem::hide_others(app, None)?)
            .separator()
            .item(&PredefinedMenuItem::quit(app, None)?)
            .build()?;
        builder = builder.item(&app_menu);
    }
    let menu = builder.item(&edit).item(&view).item(&settings).item(&help).build()?;
    app.set_menu(menu)?;
    Ok(())
}

/// 处理菜单点击。
pub fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    match id {
        "theme:light" | "theme:dark" | "theme:system" => {
            let pref = id.trim_start_matches("theme:");
            if let Ok(mut g) = state().lock() {
                g.0 = pref.to_string();
            }
            let _ = app.emit(channels::MENU_THEME, pref);
            let _ = install_menu(app);
        }
        "lang:en" | "lang:zh-CN" => {
            let lng = id.trim_start_matches("lang:");
            if let Ok(mut g) = state().lock() {
                g.1 = lng.to_string();
            }
            let _ = app.emit(channels::MENU_LANGUAGE, lng);
            let _ = install_menu(app);
        }
        "help:docs" => {
            let _ = app.opener().open_url(DOCS_URL, None::<&str>);
        }
        "help:repo" => {
            let _ = app.opener().open_url(REPO_URL, None::<&str>);
        }
        _ => {}
    }
}

// 渲染进程反向同步：启动时 ThemeProvider/i18n 会调用这些命令告知当前偏好。

#[tauri::command]
pub fn app_set_theme_pref(app: AppHandle, pref: String) -> IpcResult<()> {
    if matches!(pref.as_str(), "light" | "dark" | "system") {
        if let Ok(mut g) = state().lock() {
            g.0 = pref;
        }
        let _ = install_menu(&app);
    }
    IpcResult::ok(())
}

#[tauri::command]
pub fn app_set_language(app: AppHandle, lng: String) -> IpcResult<()> {
    if matches!(lng.as_str(), "en" | "zh-CN") {
        if let Ok(mut g) = state().lock() {
            g.1 = lng;
        }
        let _ = install_menu(&app);
    }
    IpcResult::ok(())
}
