use base64::Engine;
use tauri::menu::{MenuItem, MenuItemKind};
use tauri::Manager;

use crate::types::{RecentPaths, MAX_RECENT_SLOTS};

#[cfg(target_os = "macos")]
#[link(name = "Quartz", kind = "framework")]
extern "C" {}

#[tauri::command]
pub fn print_pdf(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let _ = &app; // used on macOS

    #[cfg(target_os = "macos")]
    {
        app.run_on_main_thread(move || {
            use objc2::msg_send;
            use objc2::runtime::{AnyClass, AnyObject};
            use objc2_foundation::{NSString, NSURL};

            let ns_path = NSString::from_str(&path);
            let url = NSURL::fileURLWithPath(&ns_path);

            let Some(pdf_class) = AnyClass::get(c"PDFDocument") else { return };
            let Some(pi_class) = AnyClass::get(c"NSPrintInfo") else { return };

            unsafe {
                let doc: *mut AnyObject = msg_send![pdf_class, alloc];
                let doc: *mut AnyObject = msg_send![doc, initWithURL: &*url];
                if doc.is_null() { return; }

                let print_info: *mut AnyObject = msg_send![pi_class, sharedPrintInfo];

                let op: *mut AnyObject = msg_send![
                    doc,
                    printOperationForPrintInfo: print_info,
                    scalingMode: 0isize,
                    autoRotate: true
                ];

                if !op.is_null() {
                    let _: bool = msg_send![op, runOperation];
                }

                let _: () = msg_send![doc, release];
            }
        }).map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("powershell")
            .args([
                "-WindowStyle", "Hidden", "-Command",
                &format!("Start-Process -FilePath '{}' -Verb Print", path.replace('\'', "''")),
            ])
            .spawn()
            .map_err(|e| format!("Failed to print: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open PDF: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub fn export_page_image(path: String, image_data: String) -> Result<(), String> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&image_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;
    std::fs::write(&path, &bytes)
        .map_err(|e| format!("Failed to write image: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn save_pdf_as(source: String, dest: String) -> Result<(), String> {
    std::fs::copy(&source, &dest)
        .map_err(|e| format!("Failed to copy: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn update_recent_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    // Store paths in managed state so on_menu_event can look them up
    let state = app.state::<RecentPaths>();
    *state.0.lock().unwrap_or_else(|e| e.into_inner()) = paths.clone();

    // Rebuild the Open Recent submenu dynamically
    let menu = app.menu().ok_or("no menu")?;
    if let Some(MenuItemKind::Submenu(recent_submenu)) = menu.get("open_recent") {
        // Remove all existing items
        if let Ok(items) = recent_submenu.items() {
            for item in items {
                let _ = recent_submenu.remove(&item);
            }
        }

        if paths.is_empty() {
            let empty_item = MenuItem::with_id(
                &app, "recent_empty", "(No Recent Files)", false, None::<&str>,
            ).map_err(|e| e.to_string())?;
            let _ = recent_submenu.append(&empty_item);
        } else {
            for (i, path) in paths.iter().enumerate().take(MAX_RECENT_SLOTS) {
                let filename = std::path::Path::new(path)
                    .file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or(path);
                let item = MenuItem::with_id(
                    &app, format!("recent_{}", i), filename, true, None::<&str>,
                ).map_err(|e| e.to_string())?;
                let _ = recent_submenu.append(&item);
            }
        }
    }

    Ok(())
}
