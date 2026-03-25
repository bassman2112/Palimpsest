use lopdf::{Document, Object, Dictionary, ObjectId};

pub(crate) const PALIMPSEST_MARKER: &[u8] = b"palimpsest";

pub(crate) fn resolve_object(doc: &Document, obj: &Object) -> Result<Object, String> {
    match obj {
        Object::Reference(id) => doc.get_object(*id)
            .map(|o| o.clone())
            .map_err(|e| format!("Failed to resolve ref: {}", e)),
        other => Ok(other.clone()),
    }
}

pub(crate) fn parse_rect(arr: &[Object]) -> Result<(f64, f64, f64, f64), String> {
    if arr.len() < 4 {
        return Err("MediaBox array too short".into());
    }
    let vals: Result<Vec<f64>, _> = arr.iter().take(4).map(|o| obj_to_f64(o)).collect();
    let v = vals.map_err(|e| format!("Failed to parse rect: {}", e))?;
    Ok((v[0], v[1], v[2], v[3]))
}

pub(crate) fn obj_to_f64(obj: &Object) -> Result<f64, String> {
    match obj {
        Object::Real(f) => Ok(*f as f64),
        Object::Integer(i) => Ok(*i as f64),
        _ => Err(format!("Not a number: {:?}", obj)),
    }
}

/// Escape parentheses and backslashes for PDF string literals
pub(crate) fn pdf_escape_text(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)")
}

/// Check if an annotation dict was created by Palimpsest (has our NM marker)
pub(crate) fn is_palimpsest_annotation(doc: &Document, annot_obj: &Object) -> bool {
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
pub(crate) fn get_existing_annots(doc: &Document, page_id: ObjectId) -> Vec<Object> {
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

pub(crate) fn get_page_media_box(doc: &Document, page_id: lopdf::ObjectId) -> Result<(f64, f64, f64, f64), String> {
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

pub(crate) fn get_parent_media_box(doc: &Document, obj_id: lopdf::ObjectId) -> Result<(f64, f64, f64, f64), String> {
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

/// Add an ExtGState entry to a page's Resources/ExtGState dictionary
pub(crate) fn add_page_ext_gstate(doc: &mut Document, page_id: ObjectId, name: &str, gs_id: ObjectId) {
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
pub(crate) fn add_page_xobject(doc: &mut Document, page_id: ObjectId, name: &str, obj_id: ObjectId) {
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

/// Add a font entry to a page's Resources/Font dictionary
pub(crate) fn add_page_font(doc: &mut Document, page_id: ObjectId, font_name: &str, font_id: ObjectId) {
    if let Ok(page_obj) = doc.get_object_mut(page_id) {
        if let Ok(dict) = page_obj.as_dict_mut() {
            let mut resources = match dict.get(b"Resources") {
                Ok(Object::Dictionary(d)) => d.clone(),
                _ => Dictionary::new(),
            };
            let mut fonts = match resources.get(b"Font") {
                Ok(Object::Dictionary(d)) => d.clone(),
                _ => Dictionary::new(),
            };
            fonts.set(font_name.as_bytes(), Object::Reference(font_id));
            resources.set("Font", Object::Dictionary(fonts));
            dict.set("Resources", Object::Dictionary(resources));
        }
    }
}

pub(crate) fn pdf_font_name(family: &str, bold: bool, italic: bool) -> &'static str {
    match (family, bold, italic) {
        ("serif", false, false) => "Times-Roman",
        ("serif", true, false) => "Times-Bold",
        ("serif", false, true) => "Times-Italic",
        ("serif", true, true) => "Times-BoldItalic",
        ("monospace", false, false) => "Courier",
        ("monospace", true, false) => "Courier-Bold",
        ("monospace", false, true) => "Courier-Oblique",
        ("monospace", true, true) => "Courier-BoldOblique",
        // sans-serif (default)
        (_, false, false) => "Helvetica",
        (_, true, false) => "Helvetica-Bold",
        (_, false, true) => "Helvetica-Oblique",
        (_, true, true) => "Helvetica-BoldOblique",
    }
}

pub(crate) fn parse_font_family_from_name(name: &str) -> (&'static str, bool, bool) {
    let lower = name.to_lowercase();
    let bold = lower.contains("bold");
    let italic = lower.contains("italic") || lower.contains("oblique");
    let family = if lower.contains("times") {
        "serif"
    } else if lower.contains("courier") {
        "monospace"
    } else {
        "sans-serif"
    };
    (family, bold, italic)
}
