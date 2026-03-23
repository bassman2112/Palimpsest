use base64::Engine;
use lopdf::{Document, Object, Dictionary, ObjectId, StringFormat};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
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

const PALIMPSEST_MARKER: &[u8] = b"palimpsest";

/// Check if an annotation dict was created by Palimpsest (has our NM marker)
fn is_palimpsest_annotation(doc: &Document, annot_obj: &Object) -> bool {
    let dict = match annot_obj {
        Object::Dictionary(d) => d,
        Object::Reference(id) => {
            match doc.get_object(*id) {
                Ok(Object::Dictionary(d)) => d,
                _ => return false,
            }
        }
        _ => return false,
    };
    match dict.get(b"NM") {
        Ok(Object::String(bytes, _)) => bytes.starts_with(PALIMPSEST_MARKER),
        _ => false,
    }
}

/// Get existing Annots array entries for a page, resolving indirect references
fn get_existing_annots(doc: &Document, page_id: ObjectId) -> Vec<Object> {
    let page_dict = match doc.get_object(page_id)
        .and_then(|o| o.as_dict().map(|d| d.clone())) {
        Ok(d) => d,
        Err(_) => return vec![],
    };
    let annots_obj = match page_dict.get(b"Annots") {
        Ok(obj) => obj.clone(),
        Err(_) => return vec![],
    };
    match resolve_object(doc, &annots_obj) {
        Ok(Object::Array(arr)) => arr,
        _ => vec![],
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

        // Collect existing non-palimpsest annotations to preserve (form widgets, links, etc.)
        let existing = get_existing_annots(&doc, *page_id);
        let mut preserved_refs: Vec<Object> = Vec::new();
        for entry in &existing {
            let resolved = match resolve_object(&doc, entry) {
                Ok(obj) => obj,
                Err(_) => continue,
            };
            if !is_palimpsest_annotation(&doc, &resolved) {
                preserved_refs.push(entry.clone());
            }
        }

        if page_annots.is_empty() && preserved_refs.is_empty() {
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

        let mut annot_refs = preserved_refs;

        for ann in &page_annots {
            let mut annot_dict = if ann.annotation_type == "highlight" {
                let pdf_x = x0 + ann.x * page_w;
                let pdf_y2 = y1 - ann.y * page_h;
                let pdf_x2 = x0 + (ann.x + ann.width) * page_w;
                let pdf_y = y1 - (ann.y + ann.height) * page_h;

                let rect = vec![
                    Object::Real(pdf_x as f32),
                    Object::Real(pdf_y as f32),
                    Object::Real(pdf_x2 as f32),
                    Object::Real(pdf_y2 as f32),
                ];

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
                dict.set("F", Object::Integer(4));
                dict
            } else {
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

            // Tag with Palimpsest marker so we can identify our annotations later
            annot_dict.set("NM", Object::String(
                PALIMPSEST_MARKER.to_vec(),
                StringFormat::Literal,
            ));

            let annot_id = doc.add_object(Object::Dictionary(annot_dict));
            annot_refs.push(Object::Reference(annot_id));
        }

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

/// Save a "locked" copy of the PDF: flatten palimpsest annotations into page
/// content streams so they become non-editable, then remove the annotations.
#[tauri::command]
fn save_locked(source: String, dest: String) -> Result<(), String> {
    use lopdf::Stream;

    // Copy source to dest first, then work on dest
    std::fs::copy(&source, &dest)
        .map_err(|e| format!("Failed to copy: {}", e))?;

    let mut doc = Document::load(&dest).map_err(|e| format!("Failed to load PDF: {}", e))?;
    let pages: Vec<(u32, ObjectId)> = doc.get_pages().into_iter().collect();

    for (_page_num, page_id) in &pages {
        let existing_annots = get_existing_annots(&doc, *page_id);
        if existing_annots.is_empty() {
            continue;
        }

        let mut extra_content = String::new();
        let mut extra_xobjects: Vec<(String, ObjectId)> = Vec::new();
        let mut non_palimpsest: Vec<Object> = Vec::new();
        let mut sig_counter = 0u32;

        for annot_ref in &existing_annots {
            let annot_obj = match resolve_object(&doc, annot_ref) {
                Ok(obj) => obj,
                Err(_) => {
                    non_palimpsest.push(annot_ref.clone());
                    continue;
                }
            };

            if !is_palimpsest_annotation(&doc, &annot_obj) {
                non_palimpsest.push(annot_ref.clone());
                continue;
            }

            let annot_dict = match &annot_obj {
                Object::Dictionary(d) => d,
                _ => continue,
            };

            let subtype = annot_dict.get(b"Subtype")
                .ok()
                .and_then(|o| match o {
                    Object::Name(n) => Some(n.clone()),
                    _ => None,
                })
                .unwrap_or_default();

            if subtype == b"Highlight" {
                // Flatten highlight: draw a semi-transparent colored rectangle
                let rect = annot_dict.get(b"Rect")
                    .ok()
                    .and_then(|o| match o {
                        Object::Array(arr) => parse_rect(arr).ok(),
                        _ => None,
                    });
                let color = annot_dict.get(b"C")
                    .ok()
                    .and_then(|o| match o {
                        Object::Array(arr) if arr.len() >= 3 => {
                            let r = obj_to_f64(&arr[0]).unwrap_or(1.0);
                            let g = obj_to_f64(&arr[1]).unwrap_or(1.0);
                            let b = obj_to_f64(&arr[2]).unwrap_or(0.0);
                            Some((r, g, b))
                        }
                        _ => None,
                    });

                if let (Some((rx, ry, rx2, ry2)), Some((r, g, b))) = (rect, color) {
                    // Create a transparency ExtGState
                    let mut gs_dict = Dictionary::new();
                    gs_dict.set("Type", Object::Name(b"ExtGState".to_vec()));
                    gs_dict.set("ca", Object::Real(0.35)); // fill opacity
                    gs_dict.set("BM", Object::Name(b"Multiply".to_vec()));
                    let gs_id = doc.add_object(Object::Dictionary(gs_dict));
                    let gs_name = format!("PGS{}", sig_counter);
                    sig_counter += 1;

                    // Add GState to page resources
                    add_page_ext_gstate(&mut doc, *page_id, &gs_name, gs_id);

                    let w = rx2 - rx;
                    let h = ry2 - ry;
                    extra_content.push_str(&format!(
                        "q /{} gs {} {} {} rg {} {} {} {} re f Q\n",
                        gs_name, r, g, b, rx, ry, w, h
                    ));
                }
            } else if subtype == b"Stamp" {
                // Flatten stamp (signature): draw the appearance stream into page content
                let ap = annot_dict.get(b"AP")
                    .ok()
                    .and_then(|o| match o {
                        Object::Dictionary(d) => Some(d.clone()),
                        _ => None,
                    });
                let ap_ref = ap.and_then(|d| {
                    d.get(b"N").ok().and_then(|o| match o {
                        Object::Reference(id) => Some(*id),
                        _ => None,
                    })
                });

                let rect = annot_dict.get(b"Rect")
                    .ok()
                    .and_then(|o| match o {
                        Object::Array(arr) => parse_rect(arr).ok(),
                        _ => None,
                    });

                if let (Some(form_id), Some((rx, ry, rx2, ry2))) = (ap_ref, rect) {
                    let xobj_name = format!("PSig{}", sig_counter);
                    sig_counter += 1;

                    let w = rx2 - rx;
                    let h = ry2 - ry;
                    // Draw the form XObject at the annotation's position
                    extra_content.push_str(&format!(
                        "q {} 0 0 {} {} {} cm /{} Do Q\n",
                        w, h, rx, ry, xobj_name
                    ));
                    extra_xobjects.push((xobj_name, form_id));
                }
            }
            // Text (sticky note) annotations are simply removed — no visual to flatten
        }

        // Append extra content to page content stream
        if !extra_content.is_empty() {
            let extra_stream_dict = Dictionary::new();
            let extra_stream = Stream::new(extra_stream_dict, extra_content.into_bytes());
            let extra_id = doc.add_object(Object::Stream(extra_stream));

            // Get existing Contents and make it an array with our extra stream appended
            if let Ok(page_obj) = doc.get_object(*page_id) {
                let page_dict = page_obj.as_dict().map(|d| d.clone()).ok();
                if let Some(pd) = page_dict {
                    let mut contents_arr = match pd.get(b"Contents") {
                        Ok(Object::Array(arr)) => arr.clone(),
                        Ok(Object::Reference(id)) => vec![Object::Reference(*id)],
                        _ => vec![],
                    };
                    contents_arr.push(Object::Reference(extra_id));
                    if let Ok(page_obj_mut) = doc.get_object_mut(*page_id) {
                        if let Ok(dict) = page_obj_mut.as_dict_mut() {
                            dict.set("Contents", Object::Array(contents_arr));
                        }
                    }
                }
            }

            // Add XObject references to page resources
            for (name, obj_id) in &extra_xobjects {
                add_page_xobject(&mut doc, *page_id, name, *obj_id);
            }
        }

        // Update Annots: keep only non-palimpsest annotations
        if let Ok(page_obj) = doc.get_object_mut(*page_id) {
            if let Ok(dict) = page_obj.as_dict_mut() {
                if non_palimpsest.is_empty() {
                    dict.remove(b"Annots");
                } else {
                    dict.set("Annots", Object::Array(non_palimpsest));
                }
            }
        }
    }

    doc.save(&dest).map_err(|e| format!("Failed to save locked PDF: {}", e))?;
    Ok(())
}

/// Add an ExtGState entry to a page's Resources/ExtGState dictionary
fn add_page_ext_gstate(doc: &mut Document, page_id: ObjectId, name: &str, gs_id: ObjectId) {
    if let Ok(page_obj) = doc.get_object_mut(page_id) {
        if let Ok(dict) = page_obj.as_dict_mut() {
            let mut resources = match dict.get(b"Resources") {
                Ok(Object::Dictionary(d)) => d.clone(),
                _ => Dictionary::new(),
            };
            let mut ext_gstate = match resources.get(b"ExtGState") {
                Ok(Object::Dictionary(d)) => d.clone(),
                _ => Dictionary::new(),
            };
            ext_gstate.set(name.as_bytes(), Object::Reference(gs_id));
            resources.set("ExtGState", Object::Dictionary(ext_gstate));
            dict.set("Resources", Object::Dictionary(resources));
        }
    }
}

/// Add an XObject entry to a page's Resources/XObject dictionary
fn add_page_xobject(doc: &mut Document, page_id: ObjectId, name: &str, obj_id: ObjectId) {
    if let Ok(page_obj) = doc.get_object_mut(page_id) {
        if let Ok(dict) = page_obj.as_dict_mut() {
            let mut resources = match dict.get(b"Resources") {
                Ok(Object::Dictionary(d)) => d.clone(),
                _ => Dictionary::new(),
            };
            let mut xobjects = match resources.get(b"XObject") {
                Ok(Object::Dictionary(d)) => d.clone(),
                _ => Dictionary::new(),
            };
            xobjects.set(name.as_bytes(), Object::Reference(obj_id));
            resources.set("XObject", Object::Dictionary(xobjects));
            dict.set("Resources", Object::Dictionary(resources));
        }
    }
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

#[derive(Deserialize)]
struct MergePageSpec {
    path: String,
    page_number: u32, // 1-indexed
}

/// BFS to collect all ObjectIds reachable from `start_id`, skipping `/Parent` keys.
fn collect_reachable(doc: &Document, start_id: ObjectId) -> Vec<ObjectId> {
    let mut visited = HashSet::new();
    let mut queue = VecDeque::new();
    visited.insert(start_id);
    queue.push_back(start_id);

    while let Some(oid) = queue.pop_front() {
        if let Ok(obj) = doc.get_object(oid) {
            collect_refs_from_object(obj, b"", &mut visited, &mut queue);
        }
    }

    visited.into_iter().collect()
}

fn collect_refs_from_object(
    obj: &Object,
    key: &[u8],
    visited: &mut HashSet<ObjectId>,
    queue: &mut VecDeque<ObjectId>,
) {
    match obj {
        Object::Reference(id) => {
            // Skip Parent references to avoid importing the entire page tree
            if key != b"Parent" && visited.insert(*id) {
                queue.push_back(*id);
            }
        }
        Object::Array(arr) => {
            for item in arr {
                collect_refs_from_object(item, b"", visited, queue);
            }
        }
        Object::Dictionary(dict) => {
            for (k, v) in dict.iter() {
                collect_refs_from_object(v, k, visited, queue);
            }
        }
        Object::Stream(stream) => {
            for (k, v) in stream.dict.iter() {
                collect_refs_from_object(v, k, visited, queue);
            }
        }
        _ => {}
    }
}

/// Recursively rewrite all Object::Reference(old) → Object::Reference(new) using the mapping.
fn remap_references(obj: &mut Object, map: &HashMap<ObjectId, ObjectId>) {
    match obj {
        Object::Reference(id) => {
            if let Some(new_id) = map.get(id) {
                *id = *new_id;
            }
        }
        Object::Array(arr) => {
            for item in arr.iter_mut() {
                remap_references(item, map);
            }
        }
        Object::Dictionary(dict) => {
            for (_k, v) in dict.iter_mut() {
                remap_references(v, map);
            }
        }
        Object::Stream(stream) => {
            for (_k, v) in stream.dict.iter_mut() {
                remap_references(v, map);
            }
        }
        _ => {}
    }
}

/// Deep-copy a page and all its reachable objects from source into target.
/// Returns the new ObjectId of the page in target.
fn import_page(
    target: &mut Document,
    source: &Document,
    page_id: ObjectId,
    target_pages_id: ObjectId,
) -> Result<ObjectId, String> {
    let reachable = collect_reachable(source, page_id);

    // Deep-copy each reachable object into target, building old→new mapping
    let mut id_map: HashMap<ObjectId, ObjectId> = HashMap::new();
    for &oid in &reachable {
        let obj = source
            .get_object(oid)
            .map_err(|e| format!("Failed to get object {:?}: {}", oid, e))?
            .clone();
        let new_id = target.add_object(obj);
        id_map.insert(oid, new_id);
    }

    // Remap all references in copied objects
    for new_id in id_map.values() {
        if let Ok(obj) = target.get_object_mut(*new_id) {
            remap_references(obj, &id_map);
        }
    }

    // Fix the new page's /Parent to point to target's Pages node
    let new_page_id = *id_map
        .get(&page_id)
        .ok_or("Page not found in id_map")?;
    if let Ok(obj) = target.get_object_mut(new_page_id) {
        if let Ok(dict) = obj.as_dict_mut() {
            dict.set("Parent", Object::Reference(target_pages_id));
        }
    }

    Ok(new_page_id)
}

#[tauri::command]
fn merge_pdfs(pages: Vec<MergePageSpec>, dest: String) -> Result<(), String> {
    if pages.is_empty() {
        return Err("No pages to merge".into());
    }

    // Deduplicate source paths → load each document once
    let mut source_docs: HashMap<String, Document> = HashMap::new();
    for spec in &pages {
        if !source_docs.contains_key(&spec.path) {
            let doc = Document::load(&spec.path)
                .map_err(|e| format!("Failed to load {}: {}", spec.path, e))?;
            source_docs.insert(spec.path.clone(), doc);
        }
    }

    // Create target document
    let mut target = Document::with_version("1.7");

    // Create Pages node
    let pages_dict = Dictionary::from_iter(vec![
        ("Type", Object::Name(b"Pages".to_vec())),
        ("Kids", Object::Array(vec![])),
        ("Count", Object::Integer(0)),
    ]);
    let pages_id = target.add_object(Object::Dictionary(pages_dict));

    // Create Catalog
    let catalog_dict = Dictionary::from_iter(vec![
        ("Type", Object::Name(b"Catalog".to_vec())),
        ("Pages", Object::Reference(pages_id)),
    ]);
    let catalog_id = target.add_object(Object::Dictionary(catalog_dict));
    target.trailer.set("Root", Object::Reference(catalog_id));

    // Import each page in order
    let mut kids: Vec<Object> = Vec::new();
    for spec in &pages {
        let source = source_docs
            .get(&spec.path)
            .ok_or_else(|| format!("Source not loaded: {}", spec.path))?;

        // Find the page's ObjectId by page number
        let source_pages = source.get_pages();
        let page_obj_id = source_pages
            .get(&spec.page_number)
            .ok_or_else(|| {
                format!(
                    "Page {} not found in {} (has {} pages)",
                    spec.page_number,
                    spec.path,
                    source_pages.len()
                )
            })?;

        let new_page_id = import_page(&mut target, source, *page_obj_id, pages_id)?;
        kids.push(Object::Reference(new_page_id));
    }

    // Update Pages node with Kids and Count
    if let Ok(obj) = target.get_object_mut(pages_id) {
        if let Ok(dict) = obj.as_dict_mut() {
            dict.set("Kids", Object::Array(kids.clone()));
            dict.set("Count", Object::Integer(kids.len() as i64));
        }
    }

    target.renumber_objects();
    target.compress();
    target
        .save(&dest)
        .map_err(|e| format!("Failed to save merged PDF: {}", e))?;

    Ok(())
}

#[derive(Deserialize)]
struct FormFieldUpdate {
    field_name: String,
    value: String,
    field_type: String, // "text", "checkbox", "radio", "choice"
}

#[tauri::command]
fn save_form_fields(path: String, fields: Vec<FormFieldUpdate>) -> Result<(), String> {
    if fields.is_empty() {
        return Ok(());
    }
    let mut doc = Document::load(&path).map_err(|e| format!("Failed to load PDF: {}", e))?;

    // Build a map of field_name -> update for quick lookup
    let field_map: HashMap<String, &FormFieldUpdate> = fields.iter()
        .map(|f| (f.field_name.clone(), f))
        .collect();

    // Walk all pages and their annotations to find Widget annotations with matching field names
    let pages: Vec<(u32, ObjectId)> = doc.get_pages().into_iter().collect();
    let mut updates: Vec<(ObjectId, String, String)> = Vec::new(); // (obj_id, value, field_type)

    for (_page_num, page_id) in &pages {
        let existing = get_existing_annots(&doc, *page_id);
        for entry in &existing {
            let obj_id = match entry {
                Object::Reference(id) => *id,
                _ => continue,
            };
            let annot_obj = match doc.get_object(obj_id) {
                Ok(obj) => obj.clone(),
                Err(_) => continue,
            };
            let annot_dict = match &annot_obj {
                Object::Dictionary(d) => d,
                _ => continue,
            };

            // Check if this is a Widget annotation
            let subtype = match annot_dict.get(b"Subtype") {
                Ok(Object::Name(name)) => String::from_utf8_lossy(name).to_string(),
                _ => continue,
            };
            if subtype != "Widget" {
                continue;
            }

            // Get field name from /T key
            let field_name = match annot_dict.get(b"T") {
                Ok(Object::String(bytes, _)) => String::from_utf8_lossy(bytes).to_string(),
                _ => continue,
            };

            if let Some(update) = field_map.get(&field_name) {
                updates.push((obj_id, update.value.clone(), update.field_type.clone()));
            }
        }
    }

    // Also walk AcroForm Fields array if present
    let catalog = doc.catalog().map_err(|e| format!("No catalog: {}", e))?.clone();
    if let Ok(acroform_ref) = catalog.get(b"AcroForm") {
        if let Ok(acroform_obj) = resolve_object(&doc, acroform_ref) {
            if let Object::Dictionary(acroform_dict) = acroform_obj {
                if let Ok(fields_obj) = acroform_dict.get(b"Fields") {
                    if let Ok(Object::Array(field_refs)) = resolve_object(&doc, fields_obj) {
                        for field_ref in &field_refs {
                            let obj_id = match field_ref {
                                Object::Reference(id) => *id,
                                _ => continue,
                            };
                            // Skip if already in updates
                            if updates.iter().any(|(id, _, _)| *id == obj_id) {
                                continue;
                            }
                            let field_obj = match doc.get_object(obj_id) {
                                Ok(obj) => obj.clone(),
                                Err(_) => continue,
                            };
                            let field_dict = match &field_obj {
                                Object::Dictionary(d) => d,
                                _ => continue,
                            };
                            let field_name = match field_dict.get(b"T") {
                                Ok(Object::String(bytes, _)) => String::from_utf8_lossy(bytes).to_string(),
                                _ => continue,
                            };
                            if let Some(update) = field_map.get(&field_name) {
                                updates.push((obj_id, update.value.clone(), update.field_type.clone()));
                            }
                        }
                    }
                }
            }
        }
    }

    // Apply updates
    for (obj_id, value, field_type) in updates {
        if let Ok(obj) = doc.get_object_mut(obj_id) {
            if let Ok(dict) = obj.as_dict_mut() {
                match field_type.as_str() {
                    "checkbox" => {
                        let val = if value == "true" || value == "Yes" {
                            Object::Name(b"Yes".to_vec())
                        } else {
                            Object::Name(b"Off".to_vec())
                        };
                        dict.set("V", val.clone());
                        dict.set("AS", val);
                    }
                    "radio" => {
                        dict.set("V", Object::Name(value.as_bytes().to_vec()));
                        dict.set("AS", Object::Name(value.as_bytes().to_vec()));
                    }
                    _ => {
                        // text, choice
                        dict.set("V", Object::String(value.as_bytes().to_vec(), StringFormat::Literal));
                    }
                }
            }
        }
    }

    doc.save(&path).map_err(|e| format!("Failed to save PDF: {}", e))?;
    Ok(())
}

#[derive(Deserialize)]
struct SignatureImageData {
    page_number: usize,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
    image_base64: String, // JPEG data (no data URL prefix)
}

#[tauri::command]
fn embed_signatures(path: String, signatures: Vec<SignatureImageData>) -> Result<(), String> {
    use lopdf::Stream;

    if signatures.is_empty() {
        return Ok(());
    }
    let mut doc = Document::load(&path).map_err(|e| format!("Failed to load PDF: {}", e))?;
    let pages: Vec<(u32, ObjectId)> = doc.get_pages().into_iter().collect();

    for sig in &signatures {
        let page_entry = pages.iter().find(|(n, _)| *n as usize == sig.page_number);
        let page_id = match page_entry {
            Some((_, id)) => *id,
            None => continue,
        };

        // Decode base64 → JPEG bytes
        let jpeg_bytes = base64::engine::general_purpose::STANDARD
            .decode(&sig.image_base64)
            .map_err(|e| format!("Failed to decode base64: {}", e))?;

        // Read JPEG dimensions using the image crate
        let reader = image::ImageReader::new(std::io::Cursor::new(&jpeg_bytes))
            .with_guessed_format()
            .map_err(|e| format!("Failed to read image format: {}", e))?;
        let (img_w, img_h) = reader.into_dimensions()
            .map_err(|e| format!("Failed to read image dimensions: {}", e))?;

        // Create Image XObject
        let mut img_dict = Dictionary::new();
        img_dict.set("Type", Object::Name(b"XObject".to_vec()));
        img_dict.set("Subtype", Object::Name(b"Image".to_vec()));
        img_dict.set("Width", Object::Integer(img_w as i64));
        img_dict.set("Height", Object::Integer(img_h as i64));
        img_dict.set("ColorSpace", Object::Name(b"DeviceRGB".to_vec()));
        img_dict.set("BitsPerComponent", Object::Integer(8));
        img_dict.set("Filter", Object::Name(b"DCTDecode".to_vec()));
        img_dict.set("Length", Object::Integer(jpeg_bytes.len() as i64));

        let img_stream = Stream::new(img_dict, jpeg_bytes);
        let img_id = doc.add_object(Object::Stream(img_stream));

        // Get page media box for coordinate conversion
        let (x0, y0, x1, y1) = get_page_media_box(&doc, page_id)?;
        let page_w = x1 - x0;
        let page_h = y1 - y0;

        // Convert normalized coords to PDF coords
        let pdf_x = x0 + sig.x * page_w;
        let pdf_y = y1 - (sig.y + sig.height) * page_h; // bottom in PDF space
        let pdf_w = sig.width * page_w;
        let pdf_h = sig.height * page_h;

        // Create Form XObject (appearance stream) that draws the image
        let ap_content = format!(
            "q {} 0 0 {} {} {} cm /SigImg Do Q",
            pdf_w, pdf_h, pdf_x, pdf_y
        );

        let mut ap_resources_xobject = Dictionary::new();
        ap_resources_xobject.set("SigImg", Object::Reference(img_id));
        let mut ap_resources = Dictionary::new();
        ap_resources.set("XObject", Object::Dictionary(ap_resources_xobject));

        let mut ap_dict = Dictionary::new();
        ap_dict.set("Type", Object::Name(b"XObject".to_vec()));
        ap_dict.set("Subtype", Object::Name(b"Form".to_vec()));
        ap_dict.set("BBox", Object::Array(vec![
            Object::Real(pdf_x as f32),
            Object::Real(pdf_y as f32),
            Object::Real((pdf_x + pdf_w) as f32),
            Object::Real((pdf_y + pdf_h) as f32),
        ]));
        ap_dict.set("Resources", Object::Dictionary(ap_resources));
        ap_dict.set("Length", Object::Integer(ap_content.len() as i64));

        let ap_stream = Stream::new(ap_dict, ap_content.into_bytes());
        let ap_id = doc.add_object(Object::Stream(ap_stream));

        // Create Stamp annotation
        let rect = vec![
            Object::Real(pdf_x as f32),
            Object::Real(pdf_y as f32),
            Object::Real((pdf_x + pdf_w) as f32),
            Object::Real((pdf_y + pdf_h) as f32),
        ];

        let mut ap_appearance = Dictionary::new();
        ap_appearance.set("N", Object::Reference(ap_id));

        let mut stamp_dict = Dictionary::new();
        stamp_dict.set("Type", Object::Name(b"Annot".to_vec()));
        stamp_dict.set("Subtype", Object::Name(b"Stamp".to_vec()));
        stamp_dict.set("Rect", Object::Array(rect));
        stamp_dict.set("AP", Object::Dictionary(ap_appearance));
        stamp_dict.set("F", Object::Integer(4)); // Print flag
        stamp_dict.set("NM", Object::String(
            PALIMPSEST_MARKER.to_vec(),
            StringFormat::Literal,
        ));

        let stamp_id = doc.add_object(Object::Dictionary(stamp_dict));

        // Add to page's Annots array
        let mut existing_annots = get_existing_annots(&doc, page_id);
        existing_annots.push(Object::Reference(stamp_id));
        if let Ok(page_obj) = doc.get_object_mut(page_id) {
            if let Ok(dict) = page_obj.as_dict_mut() {
                dict.set("Annots", Object::Array(existing_annots));
            }
        }
    }

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
            let new_tab_item = MenuItem::with_id(app, "new_tab", "New Tab", true, Some("CmdOrCtrl+T"))?;
            let close_file_item = MenuItem::with_id(app, "close_file", "Close Tab", true, Some("CmdOrCtrl+W"))?;
            let sep1 = PredefinedMenuItem::separator(app)?;
            let sep2 = PredefinedMenuItem::separator(app)?;
            let sep3 = PredefinedMenuItem::separator(app)?;
            let file_menu = Submenu::with_id_and_items(
                app, "file", "File", true,
                &[&new_tab_item, &open_item, &open_recent, &sep1, &close_file_item, &sep2, &save_item, &save_as_item, &sep3, &print_item],
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
            save_locked,
            delete_pages,
            reorder_page,
            merge_pdfs,
            save_form_fields,
            embed_signatures
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
