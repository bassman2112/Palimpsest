use base64::Engine;
use lopdf::{Document, Object, Dictionary, StringFormat};
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{Emitter, Manager};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfMetadata {
    page_count: usize,
    path: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct AnnotationData {
    pub annotation_type: String,
    pub page_number: usize,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub text: String,
    pub color: [f64; 3],
}

#[tauri::command]
fn read_pdf_bytes(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[tauri::command]
fn get_pdf_metadata(path: String) -> Result<PdfMetadata, String> {
    let doc = Document::load(&path).map_err(|e| format!("Failed to parse PDF: {}", e))?;
    let page_count = doc.get_pages().len();
    Ok(PdfMetadata {
        page_count,
        path,
    })
}

fn get_page_media_box(doc: &Document, page_id: lopdf::ObjectId) -> Result<(f64, f64, f64, f64), String> {
    let page = doc.get_object(page_id)
        .and_then(|o| o.as_dict().map(|d| d.clone()))
        .map_err(|e| format!("Failed to get page dict: {}", e))?;

    // Try MediaBox on this page, then walk up Parent chain
    if let Ok(mb) = page.get(b"MediaBox") {
        if let Ok(arr) = resolve_object(doc, mb).and_then(|o| {
            match o {
                Object::Array(a) => Ok(a),
                _ => Err("not array".into()),
            }
        }) {
            return parse_rect(&arr);
        }
    }

    // Check parent
    if let Ok(parent_ref) = page.get(b"Parent") {
        if let Object::Reference(parent_id) = parent_ref {
            return get_parent_media_box(doc, *parent_id);
        }
    }

    // Default to US Letter
    Ok((0.0, 0.0, 612.0, 792.0))
}

fn get_parent_media_box(doc: &Document, obj_id: lopdf::ObjectId) -> Result<(f64, f64, f64, f64), String> {
    let dict = doc.get_object(obj_id)
        .and_then(|o| o.as_dict().map(|d| d.clone()))
        .map_err(|e| format!("Failed to get parent: {}", e))?;

    if let Ok(mb) = dict.get(b"MediaBox") {
        if let Ok(arr) = resolve_object(doc, mb).and_then(|o| {
            match o {
                Object::Array(a) => Ok(a),
                _ => Err("not array".into()),
            }
        }) {
            return parse_rect(&arr);
        }
    }

    if let Ok(parent_ref) = dict.get(b"Parent") {
        if let Object::Reference(parent_id) = parent_ref {
            return get_parent_media_box(doc, *parent_id);
        }
    }

    Ok((0.0, 0.0, 612.0, 792.0))
}

fn resolve_object(doc: &Document, obj: &Object) -> Result<Object, String> {
    match obj {
        Object::Reference(id) => doc.get_object(*id)
            .map(|o| o.clone())
            .map_err(|e| format!("Failed to resolve ref: {}", e)),
        other => Ok(other.clone()),
    }
}

fn parse_rect(arr: &[Object]) -> Result<(f64, f64, f64, f64), String> {
    if arr.len() < 4 {
        return Err("MediaBox array too short".into());
    }
    let vals: Result<Vec<f64>, _> = arr.iter().take(4).map(|o| obj_to_f64(o)).collect();
    let v = vals.map_err(|e| format!("Failed to parse rect: {}", e))?;
    Ok((v[0], v[1], v[2], v[3]))
}

fn obj_to_f64(obj: &Object) -> Result<f64, String> {
    match obj {
        Object::Real(f) => Ok(*f as f64),
        Object::Integer(i) => Ok(*i as f64),
        _ => Err(format!("Not a number: {:?}", obj)),
    }
}

#[tauri::command]
fn save_annotations(path: String, annotations: Vec<AnnotationData>) -> Result<(), String> {
    let mut doc = Document::load(&path).map_err(|e| format!("Failed to load PDF: {}", e))?;

    let pages: Vec<(u32, lopdf::ObjectId)> = doc.get_pages().into_iter().collect();

    for (page_num, page_id) in &pages {
        let page_annots: Vec<&AnnotationData> = annotations
            .iter()
            .filter(|a| a.page_number == *page_num as usize)
            .collect();

        if page_annots.is_empty() {
            // Remove existing annotations for this page
            if let Ok(page_obj) = doc.get_object_mut(*page_id) {
                if let Ok(dict) = page_obj.as_dict_mut() {
                    dict.remove(b"Annots");
                }
            }
            continue;
        }

        let (x0, y0, x1, y1) = get_page_media_box(&doc, *page_id)?;
        let page_w = x1 - x0;
        let page_h = y1 - y0;

        let mut annot_refs = Vec::new();

        for ann in &page_annots {
            let annot_dict = if ann.annotation_type == "highlight" {
                // Convert normalized coords to PDF space (flip Y)
                let pdf_x = x0 + ann.x * page_w;
                let pdf_y2 = y1 - ann.y * page_h; // top in PDF space
                let pdf_x2 = x0 + (ann.x + ann.width) * page_w;
                let pdf_y = y1 - (ann.y + ann.height) * page_h; // bottom in PDF space

                let rect = vec![
                    Object::Real(pdf_x as f32),
                    Object::Real(pdf_y as f32),
                    Object::Real(pdf_x2 as f32),
                    Object::Real(pdf_y2 as f32),
                ];

                // QuadPoints: 4 corners in order: LL, LR, UL, UR (some readers expect UL, UR, LL, LR)
                let quad_points = vec![
                    Object::Real(pdf_x as f32),
                    Object::Real(pdf_y2 as f32),
                    Object::Real(pdf_x2 as f32),
                    Object::Real(pdf_y2 as f32),
                    Object::Real(pdf_x as f32),
                    Object::Real(pdf_y as f32),
                    Object::Real(pdf_x2 as f32),
                    Object::Real(pdf_y as f32),
                ];

                let color = vec![
                    Object::Real(ann.color[0] as f32),
                    Object::Real(ann.color[1] as f32),
                    Object::Real(ann.color[2] as f32),
                ];

                let mut dict = Dictionary::new();
                dict.set("Type", Object::Name(b"Annot".to_vec()));
                dict.set("Subtype", Object::Name(b"Highlight".to_vec()));
                dict.set("Rect", Object::Array(rect));
                dict.set("QuadPoints", Object::Array(quad_points));
                dict.set("C", Object::Array(color));
                dict.set("F", Object::Integer(4)); // Print flag
                dict
            } else {
                // Sticky note
                let pdf_x = x0 + ann.x * page_w;
                let pdf_y = y1 - ann.y * page_h;

                let rect = vec![
                    Object::Real(pdf_x as f32),
                    Object::Real((pdf_y - 24.0) as f32),
                    Object::Real((pdf_x + 24.0) as f32),
                    Object::Real(pdf_y as f32),
                ];

                let color = vec![
                    Object::Real(ann.color[0] as f32),
                    Object::Real(ann.color[1] as f32),
                    Object::Real(ann.color[2] as f32),
                ];

                let mut dict = Dictionary::new();
                dict.set("Type", Object::Name(b"Annot".to_vec()));
                dict.set("Subtype", Object::Name(b"Text".to_vec()));
                dict.set("Rect", Object::Array(rect));
                dict.set("Contents", Object::String(ann.text.as_bytes().to_vec(), StringFormat::Literal));
                dict.set("C", Object::Array(color));
                dict.set("Name", Object::Name(b"Note".to_vec()));
                dict.set("F", Object::Integer(4));
                dict.set("Open", Object::Boolean(false));
                dict
            };

            let annot_id = doc.add_object(Object::Dictionary(annot_dict));
            annot_refs.push(Object::Reference(annot_id));
        }

        // Set the Annots array on the page
        if let Ok(page_obj) = doc.get_object_mut(*page_id) {
            if let Ok(dict) = page_obj.as_dict_mut() {
                dict.set("Annots", Object::Array(annot_refs));
            }
        }
    }

    doc.save(&path).map_err(|e| format!("Failed to save PDF: {}", e))?;
    Ok(())
}

#[tauri::command]
fn read_annotations(path: String) -> Result<Vec<AnnotationData>, String> {
    let doc = Document::load(&path).map_err(|e| format!("Failed to load PDF: {}", e))?;
    let mut result = Vec::new();

    let pages: Vec<(u32, lopdf::ObjectId)> = doc.get_pages().into_iter().collect();

    for (page_num, page_id) in &pages {
        let (x0, y0, x1, y1) = get_page_media_box(&doc, *page_id)?;
        let page_w = x1 - x0;
        let page_h = y1 - y0;

        // Get Annots array
        let page_dict = doc.get_object(*page_id)
            .and_then(|o| o.as_dict().map(|d| d.clone()))
            .map_err(|e| format!("Failed to get page: {}", e))?;

        let annots_obj = match page_dict.get(b"Annots") {
            Ok(obj) => obj.clone(),
            Err(_) => continue, // No annotations on this page
        };

        let annots_array = match resolve_object(&doc, &annots_obj)? {
            Object::Array(arr) => arr,
            _ => continue,
        };

        for annot_ref in &annots_array {
            let annot_obj = resolve_object(&doc, annot_ref)?;
            let annot_dict = match &annot_obj {
                Object::Dictionary(d) => d,
                _ => continue,
            };

            let subtype = match annot_dict.get(b"Subtype") {
                Ok(Object::Name(name)) => String::from_utf8_lossy(name).to_string(),
                _ => continue,
            };

            let rect = match annot_dict.get(b"Rect") {
                Ok(obj) => {
                    let resolved = resolve_object(&doc, obj)?;
                    match resolved {
                        Object::Array(arr) => parse_rect(&arr)?,
                        _ => continue,
                    }
                }
                Err(_) => continue,
            };

            let color = match annot_dict.get(b"C") {
                Ok(obj) => {
                    let resolved = resolve_object(&doc, obj)?;
                    match resolved {
                        Object::Array(arr) if arr.len() >= 3 => {
                            [
                                obj_to_f64(&arr[0]).unwrap_or(1.0),
                                obj_to_f64(&arr[1]).unwrap_or(1.0),
                                obj_to_f64(&arr[2]).unwrap_or(0.0),
                            ]
                        }
                        _ => [1.0, 1.0, 0.0], // default yellow
                    }
                }
                Err(_) => [1.0, 1.0, 0.0],
            };

            match subtype.as_str() {
                "Highlight" => {
                    // Convert PDF coords back to normalized (flip Y)
                    let norm_x = (rect.0 - x0) / page_w;
                    let norm_y = (y1 - rect.3) / page_h; // rect.3 is top in PDF
                    let norm_w = (rect.2 - rect.0) / page_w;
                    let norm_h = (rect.3 - rect.1) / page_h;

                    result.push(AnnotationData {
                        annotation_type: "highlight".into(),
                        page_number: *page_num as usize,
                        x: norm_x,
                        y: norm_y,
                        width: norm_w,
                        height: norm_h,
                        text: String::new(),
                        color,
                    });
                }
                "Text" => {
                    let text = match annot_dict.get(b"Contents") {
                        Ok(Object::String(bytes, _)) => String::from_utf8_lossy(bytes).to_string(),
                        _ => String::new(),
                    };

                    // Position is top-right of rect
                    let norm_x = (rect.0 - x0) / page_w;
                    let norm_y = (y1 - rect.3) / page_h;

                    result.push(AnnotationData {
                        annotation_type: "sticky-note".into(),
                        page_number: *page_num as usize,
                        x: norm_x,
                        y: norm_y,
                        width: 0.0,
                        height: 0.0,
                        text,
                        color,
                    });
                }
                _ => {} // Ignore other annotation types
            }
        }
    }

    Ok(result)
}

const MAX_RECENT_SLOTS: usize = 10;

struct RecentPaths(Mutex<Vec<String>>);

#[cfg(target_os = "macos")]
#[link(name = "Quartz", kind = "framework")]
extern "C" {}

#[tauri::command]
fn print_pdf(app: tauri::AppHandle, path: String) -> Result<(), String> {
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
fn save_pdf_as(source: String, dest: String) -> Result<(), String> {
    std::fs::copy(&source, &dest)
        .map_err(|e| format!("Failed to copy: {}", e))?;
    Ok(())
}

#[tauri::command]
fn update_recent_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<(), String> {
    // Store paths in managed state so on_menu_event can look them up
    let state = app.state::<RecentPaths>();
    *state.0.lock().unwrap() = paths.clone();

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

#[tauri::command]
fn reorder_page(path: String, from: u32, to: u32) -> Result<(), String> {
    let mut doc = Document::load(&path).map_err(|e| format!("Failed to load PDF: {}", e))?;
    let total = doc.get_pages().len() as u32;
    if from < 1 || from > total || to < 1 || to > total {
        return Err(format!("Page numbers out of range (1-{})", total));
    }
    if from == to {
        return Ok(());
    }

    // Get the catalog -> Pages reference -> Pages dict -> Kids array
    let catalog = doc.catalog().map_err(|e| format!("No catalog: {}", e))?.clone();
    let pages_ref = catalog.get(b"Pages")
        .map_err(|e| format!("No Pages in catalog: {}", e))?;
    let pages_id = match pages_ref {
        Object::Reference(id) => *id,
        _ => return Err("Pages is not a reference".into()),
    };

    let pages_dict = doc.get_object_mut(pages_id)
        .map_err(|e| format!("Failed to get Pages: {}", e))?;
    let dict = pages_dict.as_dict_mut()
        .map_err(|e| format!("Pages is not a dict: {}", e))?;
    let kids = dict.get_mut(b"Kids")
        .map_err(|e| format!("No Kids array: {}", e))?;
    let kids_arr = match kids {
        Object::Array(ref mut arr) => arr,
        _ => return Err("Kids is not an array".into()),
    };

    let from_idx = (from - 1) as usize;
    let to_idx = (to - 1) as usize;
    let item = kids_arr.remove(from_idx);
    kids_arr.insert(to_idx, item);

    doc.save(&path).map_err(|e| format!("Failed to save PDF: {}", e))?;
    Ok(())
}

#[tauri::command]
fn delete_pages(path: String, page_numbers: Vec<u32>) -> Result<(), String> {
    let mut doc = Document::load(&path).map_err(|e| format!("Failed to load PDF: {}", e))?;
    let total = doc.get_pages().len();
    if page_numbers.len() >= total {
        return Err("Cannot delete all pages".into());
    }
    for &p in &page_numbers {
        if p < 1 || p as usize > total {
            return Err(format!("Page {} out of range (1-{})", p, total));
        }
    }
    doc.delete_pages(&page_numbers);
    doc.prune_objects();
    doc.save(&path).map_err(|e| format!("Failed to save PDF: {}", e))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(RecentPaths(Mutex::new(Vec::new())))
        .setup(|app| {
            // ── macOS App menu (Quit, Hide, etc.) ────────────────────
            let app_menu = Submenu::with_items(
                app,
                "Palimpsest",
                true,
                &[
                    &PredefinedMenuItem::about(app, None, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::hide(app, None)?,
                    &PredefinedMenuItem::hide_others(app, None)?,
                    &PredefinedMenuItem::show_all(app, None)?,
                    &PredefinedMenuItem::separator(app)?,
                    &PredefinedMenuItem::quit(app, None)?,
                ],
            )?;

            // ── "Open Recent" submenu (dynamically rebuilt) ──────────
            let empty_recent = MenuItem::with_id(
                app, "recent_empty", "(No Recent Files)", false, None::<&str>,
            )?;
            let open_recent = Submenu::with_id_and_items(
                app, "open_recent", "Open Recent", true, &[&empty_recent],
            )?;

            // ── File submenu ─────────────────────────────────────────
            let open_item = MenuItem::with_id(app, "open", "Open...", true, Some("CmdOrCtrl+O"))?;
            let save_item = MenuItem::with_id(app, "save", "Save", true, Some("CmdOrCtrl+S"))?;
            let save_as_item = MenuItem::with_id(app, "save_as", "Save As...", true, Some("CmdOrCtrl+Shift+S"))?;
            let print_item = MenuItem::with_id(app, "print", "Print...", true, Some("CmdOrCtrl+P"))?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let sep3 = PredefinedMenuItem::separator(app)?;
            let close_item = PredefinedMenuItem::close_window(app, None)?;

            let file_menu = Submenu::with_id_and_items(
                app, "file", "File", true,
                &[&open_item, &open_recent, &sep1, &save_item, &save_as_item, &sep2, &print_item, &sep3, &close_item],
            )?;

            // ── Edit menu (for Cmd+C/V/X/A/Z) ──────────────────────
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

            let menu = Menu::with_items(app, &[&app_menu, &file_menu, &edit_menu])?;
            app.set_menu(menu)?;

            app.on_menu_event(|app, event| {
                let id = event.id().as_ref();
                match id {
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
                    other if other.starts_with("recent_") => {
                        if let Ok(idx) = other.strip_prefix("recent_").unwrap_or("").parse::<usize>() {
                            let state = app.state::<RecentPaths>();
                            let paths = state.0.lock().unwrap();
                            if let Some(path) = paths.get(idx) {
                                let _ = app.emit("menu-open-recent", path.clone());
                            }
                        }
                    }
                    _ => {}
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_pdf_bytes,
            get_pdf_metadata,
            save_annotations,
            read_annotations,
            update_recent_files,
            print_pdf,
            save_pdf_as,
            delete_pages,
            reorder_page
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
