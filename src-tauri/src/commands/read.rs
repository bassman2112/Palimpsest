use std::fs;
use base64::Engine;
use lopdf::{Document, Object};

use crate::types::{PdfMetadata, AnnotationData};
use crate::pdf_utils::{
    resolve_object, parse_rect, obj_to_f64, is_palimpsest_annotation,
    get_page_media_box, parse_font_family_from_name,
};

#[tauri::command]
pub fn read_pdf_bytes(path: String) -> Result<String, String> {
    let bytes = fs::read(&path).map_err(|e| format!("Failed to read file: {}", e))?;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[tauri::command]
pub fn get_pdf_metadata(path: String) -> Result<PdfMetadata, String> {
    let doc = Document::load(&path).map_err(|e| format!("Failed to parse PDF: {}", e))?;
    let page_count = doc.get_pages().len();
    Ok(PdfMetadata {
        page_count,
        path,
    })
}

#[tauri::command]
pub fn read_annotations(path: String) -> Result<Vec<AnnotationData>, String> {
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
                "Highlight" | "Underline" | "StrikeOut" => {
                    // Convert PDF coords back to normalized (flip Y)
                    let norm_x = (rect.0 - x0) / page_w;
                    let norm_y = (y1 - rect.3) / page_h; // rect.3 is top in PDF
                    let norm_w = (rect.2 - rect.0) / page_w;
                    let norm_h = (rect.3 - rect.1) / page_h;

                    let annotation_type = match subtype.as_str() {
                        "Underline" => "underline",
                        "StrikeOut" => "strikethrough",
                        _ => "highlight",
                    };

                    result.push(AnnotationData {
                        annotation_type: annotation_type.into(),
                        page_number: *page_num as usize,
                        x: norm_x,
                        y: norm_y,
                        width: norm_w,
                        height: norm_h,
                        text: String::new(),
                        color,
                        paths: None,
                        stroke_width: None,
                        shape: None,
                        x1: None, y1: None, x2: None, y2: None,
                        font_size: None, font_family: None, bold: None, italic: None, underline: None, background_color: None,
                    });
                }
                "Ink" => {
                    // Only read back our own annotations
                    if !is_palimpsest_annotation(&doc, &annot_obj) {
                        continue;
                    }

                    let norm_x = (rect.0 - x0) / page_w;
                    let norm_y = (y1 - rect.3) / page_h;
                    let norm_w = (rect.2 - rect.0) / page_w;
                    let norm_h = (rect.3 - rect.1) / page_h;

                    // Read InkList
                    let ink_paths = match annot_dict.get(b"InkList") {
                        Ok(Object::Array(ink_list)) => {
                            let mut paths: Vec<Vec<f64>> = Vec::new();
                            for entry in ink_list {
                                let arr = match resolve_object(&doc, entry) {
                                    Ok(Object::Array(a)) => a,
                                    _ => continue,
                                };
                                // Convert PDF coords to normalized
                                let mut flat: Vec<f64> = Vec::new();
                                let mut i = 0;
                                while i + 1 < arr.len() {
                                    let px = obj_to_f64(&arr[i]).unwrap_or(0.0);
                                    let py = obj_to_f64(&arr[i + 1]).unwrap_or(0.0);
                                    flat.push((px - x0) / page_w);
                                    flat.push((y1 - py) / page_h);
                                    i += 2;
                                }
                                paths.push(flat);
                            }
                            Some(paths)
                        }
                        _ => None,
                    };

                    let stroke_width = match annot_dict.get(b"BS") {
                        Ok(Object::Dictionary(bs)) => {
                            match bs.get(b"W") {
                                Ok(w) => Some(obj_to_f64(w).unwrap_or(2.0)),
                                _ => Some(2.0),
                            }
                        }
                        _ => Some(2.0),
                    };

                    result.push(AnnotationData {
                        annotation_type: "ink".into(),
                        page_number: *page_num as usize,
                        x: norm_x,
                        y: norm_y,
                        width: norm_w,
                        height: norm_h,
                        text: String::new(),
                        color,
                        paths: ink_paths,
                        stroke_width,
                        shape: None,
                        x1: None, y1: None, x2: None, y2: None,
                        font_size: None, font_family: None, bold: None, italic: None, underline: None, background_color: None,
                    });
                }
                "Square" | "Circle" => {
                    if !is_palimpsest_annotation(&doc, &annot_obj) {
                        continue;
                    }
                    let norm_x1 = (rect.0 - x0) / page_w;
                    let norm_y1 = (y1 - rect.3) / page_h;
                    let norm_x2 = (rect.2 - x0) / page_w;
                    let norm_y2 = (y1 - rect.1) / page_h;
                    let shape_kind = if subtype == "Square" { "rectangle" } else { "ellipse" };
                    let stroke_w = match annot_dict.get(b"BS") {
                        Ok(Object::Dictionary(bs)) => {
                            match bs.get(b"W") {
                                Ok(w) => obj_to_f64(w).unwrap_or(2.0),
                                _ => 2.0,
                            }
                        }
                        _ => 2.0,
                    };
                    result.push(AnnotationData {
                        annotation_type: "shape".into(),
                        page_number: *page_num as usize,
                        x: 0.0, y: 0.0, width: 0.0, height: 0.0,
                        text: String::new(),
                        color,
                        paths: None,
                        stroke_width: Some(stroke_w),
                        shape: Some(shape_kind.into()),
                        x1: Some(norm_x1), y1: Some(norm_y1),
                        x2: Some(norm_x2), y2: Some(norm_y2),
                        font_size: None, font_family: None, bold: None, italic: None, underline: None, background_color: None,
                    });
                }
                "Line" => {
                    if !is_palimpsest_annotation(&doc, &annot_obj) {
                        continue;
                    }
                    // Read L array for endpoints
                    let (lx1, ly1, lx2, ly2) = match annot_dict.get(b"L") {
                        Ok(Object::Array(arr)) if arr.len() >= 4 => {
                            (
                                obj_to_f64(&arr[0]).unwrap_or(0.0),
                                obj_to_f64(&arr[1]).unwrap_or(0.0),
                                obj_to_f64(&arr[2]).unwrap_or(0.0),
                                obj_to_f64(&arr[3]).unwrap_or(0.0),
                            )
                        }
                        _ => (rect.0, rect.1, rect.2, rect.3),
                    };
                    let norm_x1 = (lx1 - x0) / page_w;
                    let norm_y1 = (y1 - ly1) / page_h;
                    let norm_x2 = (lx2 - x0) / page_w;
                    let norm_y2 = (y1 - ly2) / page_h;
                    // Check LE for arrow
                    let is_arrow = match annot_dict.get(b"LE") {
                        Ok(Object::Array(le)) => {
                            le.iter().any(|o| matches!(o, Object::Name(n) if n != b"None"))
                        }
                        _ => false,
                    };
                    let shape_kind = if is_arrow { "arrow" } else { "line" };
                    let stroke_w = match annot_dict.get(b"BS") {
                        Ok(Object::Dictionary(bs)) => {
                            match bs.get(b"W") {
                                Ok(w) => obj_to_f64(w).unwrap_or(2.0),
                                _ => 2.0,
                            }
                        }
                        _ => 2.0,
                    };
                    result.push(AnnotationData {
                        annotation_type: "shape".into(),
                        page_number: *page_num as usize,
                        x: 0.0, y: 0.0, width: 0.0, height: 0.0,
                        text: String::new(),
                        color,
                        paths: None,
                        stroke_width: Some(stroke_w),
                        shape: Some(shape_kind.into()),
                        x1: Some(norm_x1), y1: Some(norm_y1),
                        x2: Some(norm_x2), y2: Some(norm_y2),
                        font_size: None, font_family: None, bold: None, italic: None, underline: None, background_color: None,
                    });
                }
                "FreeText" => {
                    let text = match annot_dict.get(b"Contents") {
                        Ok(Object::String(bytes, _)) => String::from_utf8_lossy(bytes).to_string(),
                        _ => String::new(),
                    };

                    let norm_x = (rect.0 - x0) / page_w;
                    let norm_y = (y1 - rect.3) / page_h;
                    let norm_w = (rect.2 - rect.0) / page_w;
                    let norm_h = (rect.3 - rect.1) / page_h;

                    // Parse DA string for font info: "/FontName size Tf r g b rg"
                    let (font_size, font_family, bold, italic, da_color) = match annot_dict.get(b"DA") {
                        Ok(Object::String(bytes, _)) => {
                            let da_str = String::from_utf8_lossy(bytes).to_string();
                            let mut fs = 16.0_f64;
                            let mut ff = "sans-serif";
                            let mut b = false;
                            let mut it = false;
                            let mut dc: Option<[f64; 3]> = None;

                            // Parse font name and size from "/{font} {size} Tf"
                            if let Some(tf_pos) = da_str.find("Tf") {
                                let before = da_str[..tf_pos].trim();
                                let parts: Vec<&str> = before.split_whitespace().collect();
                                if parts.len() >= 2 {
                                    if let Ok(size) = parts[parts.len() - 1].parse::<f64>() {
                                        fs = size;
                                    }
                                    let font_name = parts[parts.len() - 2].trim_start_matches('/');
                                    let (f, bb, ii) = parse_font_family_from_name(font_name);
                                    ff = f;
                                    b = bb;
                                    it = ii;
                                }
                            }

                            // Parse color from "r g b rg"
                            if let Some(rg_pos) = da_str.find("rg") {
                                let before = da_str[..rg_pos].trim();
                                // Find last 3 numbers before "rg"
                                let parts: Vec<&str> = before.split_whitespace().collect();
                                if parts.len() >= 3 {
                                    let r = parts[parts.len() - 3].parse::<f64>().unwrap_or(0.0);
                                    let g = parts[parts.len() - 2].parse::<f64>().unwrap_or(0.0);
                                    let bv = parts[parts.len() - 1].parse::<f64>().unwrap_or(0.0);
                                    dc = Some([r, g, bv]);
                                }
                            }

                            (Some(fs), Some(ff.to_string()), Some(b), Some(it), dc)
                        }
                        _ => (None, None, None, None, None),
                    };

                    let final_color = da_color.unwrap_or(color);

                    let underline = match annot_dict.get(b"PalUnderline") {
                        Ok(Object::Boolean(b)) => Some(*b),
                        _ => None,
                    };
                    let background_color = match annot_dict.get(b"PalBgColor") {
                        Ok(Object::String(bytes, _)) => Some(String::from_utf8_lossy(bytes).to_string()),
                        _ => None,
                    };

                    result.push(AnnotationData {
                        annotation_type: "text".into(),
                        page_number: *page_num as usize,
                        x: norm_x,
                        y: norm_y,
                        width: norm_w,
                        height: norm_h,
                        text,
                        color: final_color,
                        paths: None,
                        stroke_width: None,
                        shape: None,
                        x1: None, y1: None, x2: None, y2: None,
                        font_size,
                        font_family,
                        bold,
                        italic,
                        underline,
                        background_color,
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
                        paths: None,
                        stroke_width: None,
                        shape: None,
                        x1: None, y1: None, x2: None, y2: None,
                        font_size: None, font_family: None, bold: None, italic: None, underline: None, background_color: None,
                    });
                }
                _ => {} // Ignore other annotation types
            }
        }
    }

    Ok(result)
}
