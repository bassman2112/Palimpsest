use lopdf::{Document, Object, Dictionary, ObjectId};

use crate::pdf_utils::{
    resolve_object, parse_rect, obj_to_f64, pdf_escape_text,
    is_palimpsest_annotation, get_existing_annots,
    add_page_ext_gstate, add_page_xobject, add_page_font,
};

/// Save a "locked" copy of the PDF: flatten palimpsest annotations into page
/// content streams so they become non-editable, then remove the annotations.
#[tauri::command]
pub fn save_locked(source: String, dest: String) -> Result<(), String> {
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
            } else if subtype == b"Underline" || subtype == b"StrikeOut" {
                // Flatten as a thin line
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
                            let r = obj_to_f64(&arr[0]).unwrap_or(0.0);
                            let g = obj_to_f64(&arr[1]).unwrap_or(0.0);
                            let b_val = obj_to_f64(&arr[2]).unwrap_or(0.0);
                            Some((r, g, b_val))
                        }
                        _ => None,
                    });

                if let (Some((rx, ry, rx2, ry2)), Some((r, g, b))) = (rect, color) {
                    let line_y = if subtype == b"Underline" {
                        ry // bottom of rect
                    } else {
                        (ry + ry2) / 2.0 // middle for strikethrough
                    };
                    extra_content.push_str(&format!(
                        "q {} {} {} RG 2 w {} {} m {} {} l S Q\n",
                        r, g, b, rx, line_y, rx2, line_y
                    ));
                }
            } else if subtype == b"Ink" {
                // Flatten ink: draw the strokes
                let color = annot_dict.get(b"C")
                    .ok()
                    .and_then(|o| match o {
                        Object::Array(arr) if arr.len() >= 3 => {
                            let r = obj_to_f64(&arr[0]).unwrap_or(0.0);
                            let g = obj_to_f64(&arr[1]).unwrap_or(0.0);
                            let b_val = obj_to_f64(&arr[2]).unwrap_or(0.0);
                            Some((r, g, b_val))
                        }
                        _ => None,
                    });
                let stroke_w = annot_dict.get(b"BS")
                    .ok()
                    .and_then(|o| match o {
                        Object::Dictionary(bs) => bs.get(b"W").ok().and_then(|w| obj_to_f64(w).ok()),
                        _ => None,
                    })
                    .unwrap_or(2.0);

                if let Some((r, g, b)) = color {
                    if let Ok(Object::Array(ink_list)) = annot_dict.get(b"InkList") {
                        extra_content.push_str(&format!(
                            "q {} {} {} RG {} w 1 J 1 j\n",
                            r, g, b, stroke_w
                        ));
                        for entry in ink_list {
                            let arr = match entry {
                                Object::Array(a) => a,
                                _ => continue,
                            };
                            if arr.len() < 4 { continue; }
                            let px = obj_to_f64(&arr[0]).unwrap_or(0.0);
                            let py = obj_to_f64(&arr[1]).unwrap_or(0.0);
                            extra_content.push_str(&format!("{} {} m\n", px, py));
                            let mut i = 2;
                            while i + 1 < arr.len() {
                                let lx = obj_to_f64(&arr[i]).unwrap_or(0.0);
                                let ly = obj_to_f64(&arr[i + 1]).unwrap_or(0.0);
                                extra_content.push_str(&format!("{} {} l\n", lx, ly));
                                i += 2;
                            }
                            extra_content.push_str("S\n");
                        }
                        extra_content.push_str("Q\n");
                    }
                }
            } else if subtype == b"Square" {
                // Flatten rectangle shape: stroke rect
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
                            let r = obj_to_f64(&arr[0]).unwrap_or(0.0);
                            let g = obj_to_f64(&arr[1]).unwrap_or(0.0);
                            let b_val = obj_to_f64(&arr[2]).unwrap_or(0.0);
                            Some((r, g, b_val))
                        }
                        _ => None,
                    });
                let stroke_w = annot_dict.get(b"BS")
                    .ok()
                    .and_then(|o| match o {
                        Object::Dictionary(bs) => bs.get(b"W").ok().and_then(|w| obj_to_f64(w).ok()),
                        _ => None,
                    })
                    .unwrap_or(2.0);
                if let (Some((rx, ry, rx2, ry2)), Some((r, g, b))) = (rect, color) {
                    let w = rx2 - rx;
                    let h = ry2 - ry;
                    extra_content.push_str(&format!(
                        "q {} {} {} RG {} w {} {} {} {} re S Q\n",
                        r, g, b, stroke_w, rx, ry, w, h
                    ));
                }
            } else if subtype == b"Circle" {
                // Flatten ellipse shape: 4 cubic Bezier curves
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
                            let r = obj_to_f64(&arr[0]).unwrap_or(0.0);
                            let g = obj_to_f64(&arr[1]).unwrap_or(0.0);
                            let b_val = obj_to_f64(&arr[2]).unwrap_or(0.0);
                            Some((r, g, b_val))
                        }
                        _ => None,
                    });
                let stroke_w = annot_dict.get(b"BS")
                    .ok()
                    .and_then(|o| match o {
                        Object::Dictionary(bs) => bs.get(b"W").ok().and_then(|w| obj_to_f64(w).ok()),
                        _ => None,
                    })
                    .unwrap_or(2.0);
                if let (Some((rx, ry, rx2, ry2)), Some((r, g, b))) = (rect, color) {
                    let cx = (rx + rx2) / 2.0;
                    let cy = (ry + ry2) / 2.0;
                    let a = (rx2 - rx) / 2.0; // semi-axis x
                    let bv = (ry2 - ry) / 2.0; // semi-axis y
                    let k: f64 = 0.5522847498;
                    let ka = k * a;
                    let kb = k * bv;
                    extra_content.push_str(&format!(
                        "q {} {} {} RG {} w\n\
                         {} {} m\n\
                         {} {} {} {} {} {} c\n\
                         {} {} {} {} {} {} c\n\
                         {} {} {} {} {} {} c\n\
                         {} {} {} {} {} {} c\n\
                         S Q\n",
                        r, g, b, stroke_w,
                        cx + a, cy,
                        cx + a, cy + kb, cx + ka, cy + bv, cx, cy + bv,
                        cx - ka, cy + bv, cx - a, cy + kb, cx - a, cy,
                        cx - a, cy - kb, cx - ka, cy - bv, cx, cy - bv,
                        cx + ka, cy - bv, cx + a, cy - kb, cx + a, cy
                    ));
                }
            } else if subtype == b"Line" {
                // Flatten line/arrow shape
                let color = annot_dict.get(b"C")
                    .ok()
                    .and_then(|o| match o {
                        Object::Array(arr) if arr.len() >= 3 => {
                            let r = obj_to_f64(&arr[0]).unwrap_or(0.0);
                            let g = obj_to_f64(&arr[1]).unwrap_or(0.0);
                            let b_val = obj_to_f64(&arr[2]).unwrap_or(0.0);
                            Some((r, g, b_val))
                        }
                        _ => None,
                    });
                let stroke_w = annot_dict.get(b"BS")
                    .ok()
                    .and_then(|o| match o {
                        Object::Dictionary(bs) => bs.get(b"W").ok().and_then(|w| obj_to_f64(w).ok()),
                        _ => None,
                    })
                    .unwrap_or(2.0);
                let endpoints = match annot_dict.get(b"L") {
                    Ok(Object::Array(arr)) if arr.len() >= 4 => {
                        Some((
                            obj_to_f64(&arr[0]).unwrap_or(0.0),
                            obj_to_f64(&arr[1]).unwrap_or(0.0),
                            obj_to_f64(&arr[2]).unwrap_or(0.0),
                            obj_to_f64(&arr[3]).unwrap_or(0.0),
                        ))
                    }
                    _ => None,
                };
                let is_arrow = match annot_dict.get(b"LE") {
                    Ok(Object::Array(le)) => {
                        le.iter().any(|o| matches!(o, Object::Name(n) if n != b"None"))
                    }
                    _ => false,
                };
                if let (Some((lx1, ly1, lx2, ly2)), Some((r, g, b))) = (endpoints, color) {
                    extra_content.push_str(&format!(
                        "q {} {} {} RG {} w 1 J {} {} m {} {} l S\n",
                        r, g, b, stroke_w, lx1, ly1, lx2, ly2
                    ));
                    if is_arrow {
                        // Draw arrowhead as filled triangle
                        let dx = lx2 - lx1;
                        let dy = ly2 - ly1;
                        let len = (dx * dx + dy * dy).sqrt();
                        if len > 0.0 {
                            let ux = dx / len;
                            let uy = dy / len;
                            let arrow_len = stroke_w * 5.0;
                            let arrow_w = stroke_w * 3.0;
                            let bx = lx2 - ux * arrow_len;
                            let by = ly2 - uy * arrow_len;
                            let p1x = bx - uy * arrow_w;
                            let p1y = by + ux * arrow_w;
                            let p2x = bx + uy * arrow_w;
                            let p2y = by - ux * arrow_w;
                            extra_content.push_str(&format!(
                                "{} {} {} rg {} {} m {} {} l {} {} l f\n",
                                r, g, b, lx2, ly2, p1x, p1y, p2x, p2y
                            ));
                        }
                    }
                    extra_content.push_str("Q\n");
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
            } else if subtype == b"FreeText" {
                // Flatten FreeText: render text into page content
                let text = annot_dict.get(b"Contents")
                    .ok()
                    .and_then(|o| match o {
                        Object::String(bytes, _) => Some(String::from_utf8_lossy(bytes).to_string()),
                        _ => None,
                    })
                    .unwrap_or_default();
                let rect = annot_dict.get(b"Rect")
                    .ok()
                    .and_then(|o| match o {
                        Object::Array(arr) => parse_rect(arr).ok(),
                        _ => None,
                    });

                if let Some((rx, ry, _rx2, ry2)) = rect {
                    // Parse DA for font/size/color
                    let mut font_name_str = "Helvetica".to_string();
                    let mut font_size = 16.0_f64;
                    let mut r = 0.0_f64;
                    let mut g = 0.0_f64;
                    let mut b = 0.0_f64;

                    if let Ok(Object::String(da_bytes, _)) = annot_dict.get(b"DA") {
                        let da_str = String::from_utf8_lossy(da_bytes).to_string();
                        if let Some(tf_pos) = da_str.find("Tf") {
                            let before = da_str[..tf_pos].trim();
                            let parts: Vec<&str> = before.split_whitespace().collect();
                            if parts.len() >= 2 {
                                if let Ok(size) = parts[parts.len() - 1].parse::<f64>() {
                                    font_size = size;
                                }
                                font_name_str = parts[parts.len() - 2].trim_start_matches('/').to_string();
                            }
                        }
                        if let Some(rg_pos) = da_str.find("rg") {
                            let before = da_str[..rg_pos].trim();
                            let parts: Vec<&str> = before.split_whitespace().collect();
                            if parts.len() >= 3 {
                                r = parts[parts.len() - 3].parse().unwrap_or(0.0);
                                g = parts[parts.len() - 2].parse().unwrap_or(0.0);
                                b = parts[parts.len() - 1].parse().unwrap_or(0.0);
                            }
                        }
                    }

                    let font_key = format!("PF{}", sig_counter);
                    sig_counter += 1;

                    // Create font dict for the standard 14 font
                    let mut font_dict = Dictionary::new();
                    font_dict.set("Type", Object::Name(b"Font".to_vec()));
                    font_dict.set("Subtype", Object::Name(b"Type1".to_vec()));
                    font_dict.set("BaseFont", Object::Name(font_name_str.as_bytes().to_vec()));
                    let font_id = doc.add_object(Object::Dictionary(font_dict));
                    add_page_font(&mut doc, *page_id, &font_key, font_id);

                    // Render text lines
                    let lines: Vec<&str> = text.split('\n').collect();
                    let text_y = ry2 - font_size; // Start from top of rect, descending
                    extra_content.push_str(&format!(
                        "q BT /{} {} Tf {} {} {} rg\n",
                        font_key, font_size, r, g, b
                    ));
                    for (i, line) in lines.iter().enumerate() {
                        let ly = text_y - (i as f64 * font_size * 1.3);
                        if ly < ry { break; } // Don't go below rect
                        let escaped = pdf_escape_text(line);
                        extra_content.push_str(&format!(
                            "{} {} Td ({}) Tj\n",
                            rx, ly, escaped
                        ));
                    }
                    extra_content.push_str("ET Q\n");
                }
            }
            // Text (sticky note) annotations are simply removed -- no visual to flatten
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
