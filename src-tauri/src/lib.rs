mod types;
mod pdf_utils;
mod commands;
mod menu;

pub use types::*;

use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Emitter, Manager};

static EXIT_CONFIRMED: AtomicBool = AtomicBool::new(false);

#[tauri::command]
fn confirm_and_exit(app_handle: tauri::AppHandle) {
    EXIT_CONFIRMED.store(true, Ordering::SeqCst);
    app_handle.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(RecentPaths(Mutex::new(Vec::new())))
        .setup(|app| {
            menu::setup_menu(app)?;

            #[cfg(target_os = "macos")]
            {
                use objc2::AnyThread;
                use objc2::MainThreadMarker;
                use objc2_foundation::NSData;
                use objc2_app_kit::{NSApplication, NSImage};

                let icon_bytes = include_bytes!("../icons/128x128@2x.png");
                unsafe {
                    let data = NSData::with_bytes(icon_bytes);
                    if let Some(image) = NSImage::initWithData(NSImage::alloc(), &data) {
                        let mtm = MainThreadMarker::new_unchecked();
                        let ns_app = NSApplication::sharedApplication(mtm);
                        ns_app.setApplicationIconImage(Some(&image));
                    }
                }
            }

            // Size window to ~80% of screen (floor 1200×800)
            if let Some(window) = app.get_webview_window("main") {
                if let Some(monitor) = window.current_monitor().ok().flatten() {
                    let size = monitor.size();
                    let scale = monitor.scale_factor();
                    let sw = (size.width as f64 / scale) as u32;
                    let sh = (size.height as f64 / scale) as u32;
                    let w = (sw * 4 / 5).max(1200).min(sw);
                    let h = (sh * 4 / 5).max(800).min(sh);
                    let _ = window.set_size(tauri::LogicalSize::new(w, h));
                    let _ = window.center();
                }
            }

            // Handle file path passed as CLI argument (e.g. double-click on Windows/Linux)
            if let Some(path) = std::env::args().nth(1) {
                if path.to_lowercase().ends_with(".pdf") {
                    let handle = app.handle().clone();
                    // Defer emit so frontend has time to mount
                    std::thread::spawn(move || {
                        std::thread::sleep(std::time::Duration::from_millis(500));
                        let _ = handle.emit("open-file-path", path);
                    });
                }
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::read_pdf_bytes,
            commands::get_pdf_metadata,
            commands::save_annotations,
            commands::read_annotations,
            commands::update_recent_files,
            commands::print_pdf,
            commands::save_pdf_as,
            commands::save_locked,
            commands::delete_pages,
            commands::reorder_page,
            commands::reorder_pages,
            commands::set_page_order,
            commands::merge_pdfs,
            commands::save_form_fields,
            commands::embed_signatures,
            commands::save_ink_annotations,
            commands::save_shape_annotations,
            commands::save_text_annotations,
            commands::rotate_pages,
            commands::extract_pages,
            commands::split_pdf,
            commands::insert_blank_page,
            commands::insert_image_page,
            commands::save_redaction_annotations,
            commands::apply_single_redaction,
            commands::apply_redactions,
            commands::export_page_image,
            commands::check_for_updates,
            confirm_and_exit
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle: &tauri::AppHandle, event| {
        match &event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Opened { urls } => {
                for url in urls {
                    if let Ok(path) = url.to_file_path() {
                        if let Some(ext) = path.extension() {
                            if ext.eq_ignore_ascii_case("pdf") {
                                let _ = app_handle.emit("open-file-path", path.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
            tauri::RunEvent::ExitRequested { api, .. } => {
                if !EXIT_CONFIRMED.load(Ordering::SeqCst) {
                    api.prevent_exit();
                    let _ = app_handle.emit("check-quit", ());
                }
            }
            _ => {}
        }
        let _ = app_handle;
    });
}
