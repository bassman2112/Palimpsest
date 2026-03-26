use tauri::menu::{AboutMetadata, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

use crate::types::RecentPaths;

pub(crate) fn setup_menu(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // -- macOS App menu (Quit, Hide, etc.) --
    let app_menu = Submenu::with_items(
        app,
        "Palimpsest",
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(AboutMetadata {
                name: Some("Palimpsest".into()),
                version: app.config().version.clone(),
                copyright: Some("© 2026 Alex Gelinas".into()),
                license: Some("AGPL-3.0-only".into()),
                ..Default::default()
            }))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    // -- "Open Recent" submenu (dynamically rebuilt) --
    let empty_recent = MenuItem::with_id(
        app, "recent_empty", "(No Recent Files)", false, None::<&str>,
    )?;
    let open_recent = Submenu::with_id_and_items(
        app, "open_recent", "Open Recent", true, &[&empty_recent],
    )?;

    // -- File submenu --
    let open_item = MenuItem::with_id(app, "open", "Open...", true, Some("CmdOrCtrl+O"))?;
    let save_item = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
    let save_as_item = MenuItem::with_id(app, "save_as", "Save As...", true, Some("CmdOrCtrl+Shift+S"))?;
    let save_locked_item = MenuItem::with_id(app, "save_locked", "Save Flattened...", true, None::<&str>)?;
    let merge_item = MenuItem::with_id(app, "merge", "Merge PDFs...", true, None::<&str>)?;
    let print_item = MenuItem::with_id(app, "print", "Print...", true, Some("CmdOrCtrl+P"))?;
    let new_tab_item = MenuItem::with_id(app, "new_tab", "New Tab", true, Some("CmdOrCtrl+T"))?;
    let close_file_item = MenuItem::with_id(app, "close_file", "Close Tab", true, Some("CmdOrCtrl+W"))?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let sep4 = PredefinedMenuItem::separator(app)?;
    let file_menu = Submenu::with_id_and_items(
        app, "file", "File", true,
        &[&new_tab_item, &open_item, &open_recent, &sep1, &close_file_item, &sep2, &save_item, &save_as_item, &save_locked_item, &sep3, &merge_item, &sep4, &print_item],
    )?;

    // -- Edit menu (for Cmd+C/V/X/A/Z) --
    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    // -- View menu --
    let sidebar_item = MenuItem::with_id(app, "toggle_sidebar", "Toggle Sidebar", true, Some("CmdOrCtrl+\\"))?;
    let gallery_item = MenuItem::with_id(app, "toggle_gallery", "Toggle Gallery", true, None::<&str>)?;
    let sep_v1 = PredefinedMenuItem::separator(app)?;
    let zoom_in_item = MenuItem::with_id(app, "zoom_in", "Zoom In", true, Some("CmdOrCtrl+Shift+="))?;
    let zoom_out_item = MenuItem::with_id(app, "zoom_out", "Zoom Out", true, Some("CmdOrCtrl+-"))?;
    let zoom_reset_item = MenuItem::with_id(app, "zoom_reset", "Actual Size", true, Some("CmdOrCtrl+0"))?;
    let fit_width_item = MenuItem::with_id(app, "fit_width", "Fit Width", true, None::<&str>)?;
    let fit_page_item = MenuItem::with_id(app, "fit_page", "Fit Page", true, None::<&str>)?;
    let sep_v2 = PredefinedMenuItem::separator(app)?;
    let find_item = MenuItem::with_id(app, "find", "Find...", true, Some("CmdOrCtrl+F"))?;
    let view_menu = Submenu::with_id_and_items(
        app, "view", "View", true,
        &[&sidebar_item, &gallery_item, &sep_v1, &zoom_in_item, &zoom_out_item, &zoom_reset_item, &fit_width_item, &fit_page_item, &sep_v2, &find_item],
    )?;

    // -- Help menu --
    let check_updates_item = MenuItem::with_id(app, "check_updates", "Check for Updates...", true, None::<&str>)?;
    let sep_h1 = PredefinedMenuItem::separator(app)?;
    let report_bug_item = MenuItem::with_id(app, "report_bug", "Report a Bug...", true, None::<&str>)?;
    let keyboard_shortcuts_item = MenuItem::with_id(app, "keyboard_shortcuts", "Keyboard Shortcuts", true, Some("CmdOrCtrl+/"))?;
    let help_menu = Submenu::with_id_and_items(
        app, "help", "Help", true,
        &[&check_updates_item, &sep_h1, &report_bug_item, &keyboard_shortcuts_item],
    )?;

    let menu = Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu, &view_menu, &help_menu])?;
    app.set_menu(menu)?;

    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        match id {
            "new_tab" => {
                let _ = app.emit("menu-new-tab", ());
            }
            "open" => {
                let _ = app.emit("menu-open-file", ());
            }
            "save" => {
                let _ = app.emit("menu-save", ());
            }
            "save_as" => {
                let _ = app.emit("menu-save-as", ());
            }
            "print" => {
                let _ = app.emit("menu-print", ());
            }
            "close_file" => {
                let _ = app.emit("menu-close-file", ());
            }
            "save_locked" => {
                let _ = app.emit("menu-save-locked", ());
            }
            "merge" => {
                let _ = app.emit("menu-merge", ());
            }
            "toggle_sidebar" => {
                let _ = app.emit("menu-toggle-sidebar", ());
            }
            "toggle_gallery" => {
                let _ = app.emit("menu-toggle-gallery", ());
            }
            "zoom_in" => {
                let _ = app.emit("menu-zoom-in", ());
            }
            "zoom_out" => {
                let _ = app.emit("menu-zoom-out", ());
            }
            "zoom_reset" => {
                let _ = app.emit("menu-zoom-reset", ());
            }
            "fit_width" => {
                let _ = app.emit("menu-fit-width", ());
            }
            "fit_page" => {
                let _ = app.emit("menu-fit-page", ());
            }
            "find" => {
                let _ = app.emit("menu-find", ());
            }
            "check_updates" => {
                let _ = app.emit("menu-check-updates", ());
            }
            "report_bug" => {
                let _ = app.emit("menu-report-bug", ());
            }
            "keyboard_shortcuts" => {
                let _ = app.emit("menu-keyboard-shortcuts", ());
            }
            other if other.starts_with("recent_") => {
                if let Ok(idx) = other.strip_prefix("recent_").unwrap_or("").parse::<usize>() {
                    let state = app.state::<RecentPaths>();
                    let paths = state.0.lock().unwrap_or_else(|e| e.into_inner());
                    if let Some(path) = paths.get(idx) {
                        let _ = app.emit("menu-open-recent", path.clone());
                    }
                }
            }
            _ => {}
        }
    });

    Ok(())
}
