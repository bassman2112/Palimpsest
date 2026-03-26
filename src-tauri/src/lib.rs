mod types;
mod pdf_utils;
mod commands;
mod menu;

pub use types::*;

use std::sync::Mutex;

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
            commands::export_page_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
