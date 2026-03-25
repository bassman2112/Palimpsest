use base64::Engine;
use lopdf::{Document, Object, Dictionary, ObjectId, StringFormat};

use crate::types::{
    AnnotationData, FormFieldUpdate, SignatureImageData,
    InkAnnotationData, TextAnnotationData, ShapeAnnotationData,
};
use crate::pdf_utils::{
    PALIMPSEST_MARKER, resolve_object,
    is_palimpsest_annotation, get_existing_annots, get_page_media_box,
    pdf_font_name,
};

/// Remove palimpsest annotations matching any of the given subtypes from all pages.
pub(crate) fn remove_palimpsest_annots_by_subtype(
    doc: &mut Document,
    pages: &[(u32, ObjectId)],
    subtypes: &[&[u8]],
) {
    for (_page_num, page_id) in pages {
        let existing = get_existing_annots(doc, *page_id);
        let mut kept: Vec<Object> = Vec::new();
        for entry in &existing {
            let resolved = match resolve_object(doc, entry) {
                Ok(obj) => obj,
                Err(_) => { kept.push(entry.clone()); continue; }
            };
            let dict = match &resolved {
                Object::Dictionary(d) => d,
                _ => { kept.push(entry.clone()); continue; }
            };
            let subtype = match dict.get(b"Subtype") {
                Ok(Object::Name(n)) => n.clone(),
                _ => { kept.push(entry.clone()); continue; }
            };
            if subtypes.iter().any(|s| subtype == *s) && is_palimpsest_annotation(doc, &resolved) {
                // Remove this annotation (don't keep it)
            } else {
                kept.push(entry.clone());
            }
        }
        if let Ok(page_obj) = doc.get_object_mut(*page_id) {
            if let Ok(dict) = page_obj.as_dict_mut() {
                if kept.is_empty() {
                    dict.remove(b"Annots");
                } else {
                    dict.set("Annots", Object::Array(kept));
                }
            }
        }
    }
}

#[tauri::command]
pub fn save_annotations(path: String, annotations: Vec<AnnotationData>) -> Result<(), String> {
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

        let (x0, _y0, x1, y1) = get_page_media_box(&doc, *page_id)?;
        let page_w = x1 - x0;
        let page_h = y1 - _y0;

        let mut annot_refs = preserved_refs;

        for ann in &page_annots {
            let mut annot_dict = if ann.annotation_type == "highlight"
                || ann.annotation_type == "underline"
                || ann.annotation_type == "strikethrough"
            {
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

                let subtype = match ann.annotation_type.as_str() {
                    "underline" => b"Underline".to_vec(),
                    "strikethrough" => b"StrikeOut".to_vec(),
                    _ => b"Highlight".to_vec(),
                };

                let mut dict = Dictionary::new();
                dict.set("Type", Object::Name(b"Annot".to_vec()));
                dict.set("Subtype", Object::Name(subtype));
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
pub fn save_ink_annotations(path: String, annotations: Vec<InkAnnotationData>) -> Result<(), String> {
    if annotations.is_empty() {
        return Ok(());
    }

    let mut doc = Document::load(&path).map_err(|e| format!("Failed to load PDF: {}", e))?;
    let pages: Vec<(u32, ObjectId)> = doc.get_pages().into_iter().collect();

    // Remove existing palimpsest Ink annotations
    remove_palimpsest_annots_by_subtype(&mut doc, &pages, &[b"Ink"]);

    // Now add new ink annotations
    for ann in &annotations {
        let page_entry = pages.iter().find(|(n, _)| *n as usize == ann.page_number);
        let page_id = match page_entry {
            Some((_, id)) => *id,
            None => continue,
        };

        let (x0, _y0, x1, y1) = get_page_media_box(&doc, page_id)?;
        let page_w = x1 - x0;
        let page_h = y1 - _y0;

        // Convert normalized coords to PDF coords
        let pdf_x = x0 + ann.x * page_w;
        let pdf_y = y1 - (ann.y + ann.height) * page_h;
        let pdf_x2 = x0 + (ann.x + ann.width) * page_w;
        let pdf_y2 = y1 - ann.y * page_h;

        let rect = vec![
            Object::Real(pdf_x as f32),
            Object::Real(pdf_y as f32),
            Object::Real(pdf_x2 as f32),
            Object::Real(pdf_y2 as f32),
        ];

        let color = vec![
            Object::Real(ann.color[0] as f32),
            Object::Real(ann.color[1] as f32),
            Object::Real(ann.color[2] as f32),
        ];

        // Build InkList: each path is an array of alternating x,y in PDF coords
        let ink_list: Vec<Object> = ann.paths.iter().map(|flat| {
            let mut points: Vec<Object> = Vec::new();
            let mut i = 0;
            while i + 1 < flat.len() {
                let norm_x = flat[i];
                let norm_y = flat[i + 1];
                let px = x0 + norm_x * page_w;
                let py = y1 - norm_y * page_h;
                points.push(Object::Real(px as f32));
                points.push(Object::Real(py as f32));
                i += 2;
            }
            Object::Array(points)
        }).collect();

        // Border style
        let mut bs_dict = Dictionary::new();
        bs_dict.set("W", Object::Real(ann.stroke_width as f32));
        bs_dict.set("S", Object::Name(b"S".to_vec()));

        let mut annot_dict = Dictionary::new();
        annot_dict.set("Type", Object::Name(b"Annot".to_vec()));
        annot_dict.set("Subtype", Object::Name(b"Ink".to_vec()));
        annot_dict.set("Rect", Object::Array(rect));
        annot_dict.set("InkList", Object::Array(ink_list));
        annot_dict.set("C", Object::Array(color));
        annot_dict.set("BS", Object::Dictionary(bs_dict));
        annot_dict.set("F", Object::Integer(4));
        annot_dict.set("NM", Object::String(
            PALIMPSEST_MARKER.to_vec(),
            StringFormat::Literal,
        ));

        let annot_id = doc.add_object(Object::Dictionary(annot_dict));

        // Add to page's Annots array
        let mut existing_annots = get_existing_annots(&doc, page_id);
        existing_annots.push(Object::Reference(annot_id));
        if let Ok(page_obj) = doc.get_object_mut(page_id) {
            if let Ok(dict) = page_obj.as_dict_mut() {
                dict.set("Annots", Object::Array(existing_annots));
            }
        }
    }

    doc.save(&path).map_err(|e| format!("Failed to save PDF: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn save_text_annotations(path: String, annotations: Vec<TextAnnotationData>) -> Result<(), String> {
    if annotations.is_empty() {
        return Ok(());
    }

    let mut doc = Document::load(&path).map_err(|e| format!("Failed to load PDF: {}", e))?;
    let pages: Vec<(u32, ObjectId)> = doc.get_pages().into_iter().collect();

    // Remove existing palimpsest FreeText annotations
    remove_palimpsest_annots_by_subtype(&mut doc, &pages, &[b"FreeText"]);

    // Add new text annotations
    for ann in &annotations {
        let page_entry = pages.iter().find(|(n, _)| *n as usize == ann.page_number);
        let page_id = match page_entry {
            Some((_, id)) => *id,
            None => continue,
        };

        let (x0, _y0, x1, y1) = get_page_media_box(&doc, page_id)?;
        let page_w = x1 - x0;
        let page_h = y1 - _y0;

        let pdf_x = x0 + ann.x * page_w;
        let pdf_y2 = y1 - ann.y * page_h; // top in PDF coords
        let pdf_x2 = x0 + (ann.x + ann.width) * page_w;
        let pdf_y = y1 - (ann.y + ann.height) * page_h; // bottom in PDF coords

        let font_name = pdf_font_name(&ann.font_family, ann.bold, ann.italic);
        let da = format!("/{} {} Tf {} {} {} rg",
            font_name, ann.font_size,
            ann.color[0], ann.color[1], ann.color[2]);

        let rect = vec![
            Object::Real(pdf_x as f32),
            Object::Real(pdf_y as f32),
            Object::Real(pdf_x2 as f32),
            Object::Real(pdf_y2 as f32),
        ];

        let color = vec![
            Object::Real(ann.color[0] as f32),
            Object::Real(ann.color[1] as f32),
            Object::Real(ann.color[2] as f32),
        ];

        let mut annot_dict = Dictionary::new();
        annot_dict.set("Type", Object::Name(b"Annot".to_vec()));
        annot_dict.set("Subtype", Object::Name(b"FreeText".to_vec()));
        annot_dict.set("Rect", Object::Array(rect));
        annot_dict.set("Contents", Object::String(ann.text.as_bytes().to_vec(), StringFormat::Literal));
        annot_dict.set("DA", Object::String(da.into_bytes(), StringFormat::Literal));
        annot_dict.set("C", Object::Array(color));
        annot_dict.set("F", Object::Integer(4));
        if ann.underline {
            annot_dict.set("PalUnderline", Object::Boolean(true));
        }
        if ann.background_color != "transparent" {
            annot_dict.set("PalBgColor", Object::String(
                ann.background_color.as_bytes().to_vec(),
                StringFormat::Literal,
            ));
        }
        annot_dict.set("NM", Object::String(
            PALIMPSEST_MARKER.to_vec(),
            StringFormat::Literal,
        ));

        let annot_id = doc.add_object(Object::Dictionary(annot_dict));
        let mut existing_annots = get_existing_annots(&doc, page_id);
        existing_annots.push(Object::Reference(annot_id));
        if let Ok(page_obj) = doc.get_object_mut(page_id) {
            if let Ok(dict) = page_obj.as_dict_mut() {
                dict.set("Annots", Object::Array(existing_annots));
            }
        }
    }

    doc.save(&path).map_err(|e| format!("Failed to save PDF: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn save_shape_annotations(path: String, annotations: Vec<ShapeAnnotationData>) -> Result<(), String> {
    if annotations.is_empty() {
        return Ok(());
    }

    let mut doc = Document::load(&path).map_err(|e| format!("Failed to load PDF: {}", e))?;
    let pages: Vec<(u32, ObjectId)> = doc.get_pages().into_iter().collect();

    // Remove existing palimpsest shape annotations (Square, Circle, Line)
    remove_palimpsest_annots_by_subtype(&mut doc, &pages, &[b"Square", b"Circle", b"Line"]);

    // Now add new shape annotations
    for ann in &annotations {
        let page_entry = pages.iter().find(|(n, _)| *n as usize == ann.page_number);
        let page_id = match page_entry {
            Some((_, id)) => *id,
            None => continue,
        };

        let (x0, _y0, x1, y1) = get_page_media_box(&doc, page_id)?;
        let page_w = x1 - x0;
        let page_h = y1 - _y0;

        let color = vec![
            Object::Real(ann.color[0] as f32),
            Object::Real(ann.color[1] as f32),
            Object::Real(ann.color[2] as f32),
        ];

        let mut bs_dict = Dictionary::new();
        bs_dict.set("W", Object::Real(ann.stroke_width as f32));
        bs_dict.set("S", Object::Name(b"S".to_vec()));

        let mut annot_dict = Dictionary::new();
        annot_dict.set("Type", Object::Name(b"Annot".to_vec()));
        annot_dict.set("C", Object::Array(color));
        annot_dict.set("BS", Object::Dictionary(bs_dict));
        annot_dict.set("F", Object::Integer(4));
        annot_dict.set("NM", Object::String(
            PALIMPSEST_MARKER.to_vec(),
            StringFormat::Literal,
        ));

        match ann.shape.as_str() {
            "rectangle" | "ellipse" => {
                let pdf_x1 = x0 + ann.x1 * page_w;
                let pdf_y1 = y1 - ann.y1 * page_h;
                let pdf_x2 = x0 + ann.x2 * page_w;
                let pdf_y2 = y1 - ann.y2 * page_h;
                let rx = pdf_x1.min(pdf_x2);
                let ry = pdf_y1.min(pdf_y2);
                let rx2 = pdf_x1.max(pdf_x2);
                let ry2 = pdf_y1.max(pdf_y2);
                let rect = vec![
                    Object::Real(rx as f32),
                    Object::Real(ry as f32),
                    Object::Real(rx2 as f32),
                    Object::Real(ry2 as f32),
                ];
                let subtype = if ann.shape == "rectangle" { b"Square".to_vec() } else { b"Circle".to_vec() };
                annot_dict.set("Subtype", Object::Name(subtype));
                annot_dict.set("Rect", Object::Array(rect));
            }
            "line" | "arrow" => {
                let pdf_x1 = x0 + ann.x1 * page_w;
                let pdf_y1 = y1 - ann.y1 * page_h;
                let pdf_x2 = x0 + ann.x2 * page_w;
                let pdf_y2 = y1 - ann.y2 * page_h;
                // Rect is bounding box of the line
                let rx = pdf_x1.min(pdf_x2);
                let ry = pdf_y1.min(pdf_y2);
                let rx2 = pdf_x1.max(pdf_x2);
                let ry2 = pdf_y1.max(pdf_y2);
                let rect = vec![
                    Object::Real(rx as f32),
                    Object::Real(ry as f32),
                    Object::Real(rx2 as f32),
                    Object::Real(ry2 as f32),
                ];
                let l_arr = vec![
                    Object::Real(pdf_x1 as f32),
                    Object::Real(pdf_y1 as f32),
                    Object::Real(pdf_x2 as f32),
                    Object::Real(pdf_y2 as f32),
                ];
                annot_dict.set("Subtype", Object::Name(b"Line".to_vec()));
                annot_dict.set("Rect", Object::Array(rect));
                annot_dict.set("L", Object::Array(l_arr));
                if ann.shape == "arrow" {
                    annot_dict.set("LE", Object::Array(vec![
                        Object::Name(b"None".to_vec()),
                        Object::Name(b"OpenArrow".to_vec()),
                    ]));
                }
            }
            _ => continue,
        }

        let annot_id = doc.add_object(Object::Dictionary(annot_dict));
        let mut existing_annots = get_existing_annots(&doc, page_id);
        existing_annots.push(Object::Reference(annot_id));
        if let Ok(page_obj) = doc.get_object_mut(page_id) {
            if let Ok(dict) = page_obj.as_dict_mut() {
                dict.set("Annots", Object::Array(existing_annots));
            }
        }
    }

    doc.save(&path).map_err(|e| format!("Failed to save PDF: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn save_form_fields(path: String, fields: Vec<FormFieldUpdate>) -> Result<(), String> {
    if fields.is_empty() {
        return Ok(());
    }
    let mut doc = Document::load(&path).map_err(|e| format!("Failed to load PDF: {}", e))?;

    // Build a map of field_name -> update for quick lookup
    let field_map: std::collections::HashMap<String, &FormFieldUpdate> = fields.iter()
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

#[tauri::command]
pub fn embed_signatures(path: String, signatures: Vec<SignatureImageData>) -> Result<(), String> {
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

        // Decode base64 -> JPEG bytes
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
        let (x0, _y0, x1, y1) = get_page_media_box(&doc, page_id)?;
        let page_w = x1 - x0;
        let page_h = y1 - _y0;

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
