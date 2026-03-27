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
#[cfg(test)]
pub(crate) fn pdf_escape_text(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('(', "\\(")
        .replace(')', "\\)")
}

/// Convert a UTF-8 char to its WinAnsiEncoding byte (used by standard Type1 fonts).
/// Returns None if the character has no mapping.
fn win_ansi_byte(ch: char) -> Option<u8> {
    let cp = ch as u32;
    match cp {
        0x00..=0x7F => Some(cp as u8),
        0xA0..=0xFF => Some(cp as u8),
        _ => match ch {
            '\u{2018}' => Some(0x91), // '
            '\u{2019}' => Some(0x92), // '
            '\u{201C}' => Some(0x93), // "
            '\u{201D}' => Some(0x94), // "
            '\u{2013}' => Some(0x96), // –
            '\u{2014}' => Some(0x97), // —
            '\u{2026}' => Some(0x85), // …
            '\u{2022}' => Some(0x95), // •
            '\u{2020}' => Some(0x86), // †
            '\u{2021}' => Some(0x87), // ‡
            '\u{2030}' => Some(0x89), // ‰
            '\u{0152}' => Some(0x8C), // Œ
            '\u{0153}' => Some(0x9C), // œ
            '\u{0160}' => Some(0x8A), // Š
            '\u{0161}' => Some(0x9A), // š
            '\u{0178}' => Some(0x9F), // Ÿ
            '\u{017D}' => Some(0x8E), // Ž
            '\u{017E}' => Some(0x9E), // ž
            '\u{0192}' => Some(0x83), // ƒ
            '\u{02DC}' => Some(0x98), // ˜
            '\u{2122}' => Some(0x99), // ™
            _ => None,
        },
    }
}

/// Convert UTF-8 text to a PDF hex string (<...>) using WinAnsiEncoding.
/// Characters without a WinAnsi mapping are replaced with '?'.
pub(crate) fn utf8_to_pdf_hex(text: &str) -> String {
    let hex: String = text
        .chars()
        .map(|ch| win_ansi_byte(ch).unwrap_or(b'?'))
        .map(|b| format!("{:02X}", b))
        .collect();
    format!("<{}>", hex)
}

/// Word-wrap text to fit within a given width using approximate character widths.
/// Returns lines split at word boundaries, preserving explicit newlines.
pub(crate) fn wrap_text_for_pdf(text: &str, max_width: f64, font_size: f64) -> Vec<String> {
    // Average character width for Helvetica-like fonts: ~0.5 * font_size
    // Use a slightly conservative estimate to avoid overflow
    let avg_char_width = font_size * 0.48;
    let max_chars = if avg_char_width > 0.0 {
        (max_width / avg_char_width).floor() as usize
    } else {
        usize::MAX
    };
    if max_chars == 0 {
        return vec![text.to_string()];
    }

    let mut lines = Vec::new();
    for paragraph in text.split('\n') {
        let words: Vec<&str> = paragraph.split_whitespace().collect();
        if words.is_empty() {
            lines.push(String::new());
            continue;
        }
        let mut current_line = words[0].to_string();
        for word in &words[1..] {
            if current_line.len() + 1 + word.len() > max_chars {
                lines.push(current_line);
                current_line = word.to_string();
            } else {
                current_line.push(' ');
                current_line.push_str(word);
            }
        }
        lines.push(current_line);
    }
    lines
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

/// Resolve a dictionary value that may be inline or an indirect reference.
fn resolve_dict(doc: &Document, parent: &Dictionary, key: &[u8]) -> Dictionary {
    match parent.get(key) {
        Ok(Object::Dictionary(d)) => d.clone(),
        Ok(Object::Reference(id)) => doc
            .get_object(*id)
            .ok()
            .and_then(|o| if let Object::Dictionary(d) = o { Some(d.clone()) } else { None })
            .unwrap_or_default(),
        _ => Dictionary::new(),
    }
}

/// Add an ExtGState entry to a page's Resources/ExtGState dictionary
pub(crate) fn add_page_ext_gstate(doc: &mut Document, page_id: ObjectId, name: &str, gs_id: ObjectId) {
    let resources = {
        let page_obj = match doc.get_object(page_id) {
            Ok(obj) => obj,
            _ => return,
        };
        let dict = match page_obj.as_dict() {
            Ok(d) => d,
            _ => return,
        };
        let mut resources = resolve_dict(doc, dict, b"Resources");
        let mut ext_gstate = resolve_dict(doc, &resources, b"ExtGState");
        ext_gstate.set(name.as_bytes(), Object::Reference(gs_id));
        resources.set("ExtGState", Object::Dictionary(ext_gstate));
        resources
    };
    if let Ok(page_obj) = doc.get_object_mut(page_id) {
        if let Ok(dict) = page_obj.as_dict_mut() {
            dict.set("Resources", Object::Dictionary(resources));
        }
    }
}

/// Add an XObject entry to a page's Resources/XObject dictionary
pub(crate) fn add_page_xobject(doc: &mut Document, page_id: ObjectId, name: &str, obj_id: ObjectId) {
    let resources = {
        let page_obj = match doc.get_object(page_id) {
            Ok(obj) => obj,
            _ => return,
        };
        let dict = match page_obj.as_dict() {
            Ok(d) => d,
            _ => return,
        };
        let mut resources = resolve_dict(doc, dict, b"Resources");
        let mut xobjects = resolve_dict(doc, &resources, b"XObject");
        xobjects.set(name.as_bytes(), Object::Reference(obj_id));
        resources.set("XObject", Object::Dictionary(xobjects));
        resources
    };
    if let Ok(page_obj) = doc.get_object_mut(page_id) {
        if let Ok(dict) = page_obj.as_dict_mut() {
            dict.set("Resources", Object::Dictionary(resources));
        }
    }
}

/// Add a font entry to a page's Resources/Font dictionary
pub(crate) fn add_page_font(doc: &mut Document, page_id: ObjectId, font_name: &str, font_id: ObjectId) {
    let resources = {
        let page_obj = match doc.get_object(page_id) {
            Ok(obj) => obj,
            _ => return,
        };
        let dict = match page_obj.as_dict() {
            Ok(d) => d,
            _ => return,
        };
        let mut resources = resolve_dict(doc, dict, b"Resources");
        let mut fonts = resolve_dict(doc, &resources, b"Font");
        fonts.set(font_name.as_bytes(), Object::Reference(font_id));
        resources.set("Font", Object::Dictionary(fonts));
        resources
    };
    if let Ok(page_obj) = doc.get_object_mut(page_id) {
        if let Ok(dict) = page_obj.as_dict_mut() {
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

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{Document, Object, Dictionary, StringFormat};

    // --- Pure function tests (no Document needed) ---

    #[test]
    fn obj_to_f64_integer() {
        assert_eq!(obj_to_f64(&Object::Integer(42)).unwrap(), 42.0);
    }

    #[test]
    fn obj_to_f64_real() {
        let val = obj_to_f64(&Object::Real(3.14)).unwrap();
        assert!((val - 3.14).abs() < 0.001);
    }

    #[test]
    fn obj_to_f64_string_err() {
        assert!(obj_to_f64(&Object::String(b"x".to_vec(), StringFormat::Literal)).is_err());
    }

    #[test]
    fn parse_rect_valid() {
        let arr = vec![
            Object::Integer(0),
            Object::Integer(0),
            Object::Real(612.0),
            Object::Real(792.0),
        ];
        let (x1, y1, x2, y2) = parse_rect(&arr).unwrap();
        assert_eq!(x1, 0.0);
        assert_eq!(y1, 0.0);
        assert!((x2 - 612.0).abs() < 0.001);
        assert!((y2 - 792.0).abs() < 0.001);
    }

    #[test]
    fn parse_rect_too_short() {
        let arr = vec![Object::Integer(0), Object::Integer(0), Object::Integer(612)];
        assert!(parse_rect(&arr).is_err());
    }

    #[test]
    fn pdf_escape_text_parens() {
        assert_eq!(pdf_escape_text("Hello (world)"), "Hello \\(world\\)");
    }

    #[test]
    fn pdf_escape_text_backslash() {
        assert_eq!(pdf_escape_text("a\\b"), "a\\\\b");
    }

    #[test]
    fn pdf_escape_text_clean() {
        assert_eq!(pdf_escape_text("Hello world"), "Hello world");
    }

    // --- pdf_font_name: all 12 combos ---

    #[test]
    fn font_name_serif() {
        assert_eq!(pdf_font_name("serif", false, false), "Times-Roman");
        assert_eq!(pdf_font_name("serif", true, false), "Times-Bold");
        assert_eq!(pdf_font_name("serif", false, true), "Times-Italic");
        assert_eq!(pdf_font_name("serif", true, true), "Times-BoldItalic");
    }

    #[test]
    fn font_name_monospace() {
        assert_eq!(pdf_font_name("monospace", false, false), "Courier");
        assert_eq!(pdf_font_name("monospace", true, false), "Courier-Bold");
        assert_eq!(pdf_font_name("monospace", false, true), "Courier-Oblique");
        assert_eq!(pdf_font_name("monospace", true, true), "Courier-BoldOblique");
    }

    #[test]
    fn font_name_sans_serif() {
        assert_eq!(pdf_font_name("sans-serif", false, false), "Helvetica");
        assert_eq!(pdf_font_name("sans-serif", true, false), "Helvetica-Bold");
        assert_eq!(pdf_font_name("sans-serif", false, true), "Helvetica-Oblique");
        assert_eq!(pdf_font_name("sans-serif", true, true), "Helvetica-BoldOblique");
    }

    #[test]
    fn font_name_unknown_defaults_sans() {
        assert_eq!(pdf_font_name("fantasy", false, false), "Helvetica");
    }

    // --- parse_font_family_from_name ---

    #[test]
    fn parse_font_times_bold() {
        assert_eq!(parse_font_family_from_name("Times-Bold"), ("serif", true, false));
    }

    #[test]
    fn parse_font_courier_bold_oblique() {
        assert_eq!(parse_font_family_from_name("Courier-BoldOblique"), ("monospace", true, true));
    }

    #[test]
    fn parse_font_helvetica() {
        assert_eq!(parse_font_family_from_name("Helvetica"), ("sans-serif", false, false));
    }

    #[test]
    fn parse_font_unknown_defaults_sans() {
        assert_eq!(parse_font_family_from_name("UnknownFont"), ("sans-serif", false, false));
    }

    // --- Tests requiring in-memory Document ---

    #[test]
    fn resolve_object_direct() {
        let doc = Document::new();
        let obj = Object::Integer(42);
        let resolved = resolve_object(&doc, &obj).unwrap();
        assert_eq!(resolved, Object::Integer(42));
    }

    #[test]
    fn resolve_object_reference() {
        let mut doc = Document::new();
        let id = doc.add_object(Object::Integer(99));
        let resolved = resolve_object(&doc, &Object::Reference(id)).unwrap();
        assert_eq!(resolved, Object::Integer(99));
    }

    #[test]
    fn is_palimpsest_annotation_true() {
        let mut dict = Dictionary::new();
        dict.set("NM", Object::String(b"palimpsest-abc123".to_vec(), StringFormat::Literal));
        dict.set("Type", Object::Name(b"Annot".to_vec()));
        let doc = Document::new();
        assert!(is_palimpsest_annotation(&doc, &Object::Dictionary(dict)));
    }

    #[test]
    fn is_palimpsest_annotation_no_nm() {
        let mut dict = Dictionary::new();
        dict.set("Type", Object::Name(b"Annot".to_vec()));
        let doc = Document::new();
        assert!(!is_palimpsest_annotation(&doc, &Object::Dictionary(dict)));
    }

    #[test]
    fn is_palimpsest_annotation_non_dict() {
        let doc = Document::new();
        assert!(!is_palimpsest_annotation(&doc, &Object::Integer(42)));
    }

    /// Helper: build a minimal PDF Document with N blank pages
    fn build_doc_with_pages(n: usize) -> (Document, Vec<ObjectId>) {
        let mut doc = Document::new();
        let pages_id = doc.new_object_id();
        let mut kids: Vec<Object> = Vec::new();
        let mut page_ids = Vec::new();
        for _ in 0..n {
            let mut page_dict = Dictionary::new();
            page_dict.set("Type", Object::Name(b"Page".to_vec()));
            page_dict.set("Parent", Object::Reference(pages_id));
            page_dict.set("MediaBox", Object::Array(vec![
                Object::Integer(0), Object::Integer(0),
                Object::Integer(612), Object::Integer(792),
            ]));
            let page_id = doc.add_object(Object::Dictionary(page_dict));
            kids.push(Object::Reference(page_id));
            page_ids.push(page_id);
        }
        let mut pages_dict = Dictionary::new();
        pages_dict.set("Type", Object::Name(b"Pages".to_vec()));
        pages_dict.set("Count", Object::Integer(n as i64));
        pages_dict.set("Kids", Object::Array(kids));
        doc.objects.insert(pages_id, Object::Dictionary(pages_dict));

        let mut catalog = Dictionary::new();
        catalog.set("Type", Object::Name(b"Catalog".to_vec()));
        catalog.set("Pages", Object::Reference(pages_id));
        let catalog_id = doc.add_object(Object::Dictionary(catalog));
        doc.trailer.set("Root", Object::Reference(catalog_id));
        (doc, page_ids)
    }

    #[test]
    fn get_existing_annots_with_annots() {
        let (mut doc, page_ids) = build_doc_with_pages(1);
        let annot_ref1 = doc.add_object(Object::Integer(1));
        let annot_ref2 = doc.add_object(Object::Integer(2));
        // Add Annots array to the page
        if let Ok(page_obj) = doc.get_object_mut(page_ids[0]) {
            if let Ok(dict) = page_obj.as_dict_mut() {
                dict.set("Annots", Object::Array(vec![
                    Object::Reference(annot_ref1),
                    Object::Reference(annot_ref2),
                ]));
            }
        }
        let annots = get_existing_annots(&doc, page_ids[0]);
        assert_eq!(annots.len(), 2);
    }

    #[test]
    fn get_existing_annots_without_annots() {
        let (doc, page_ids) = build_doc_with_pages(1);
        let annots = get_existing_annots(&doc, page_ids[0]);
        assert!(annots.is_empty());
    }

    #[test]
    fn get_page_media_box_direct() {
        let (doc, page_ids) = build_doc_with_pages(1);
        let (x1, y1, x2, y2) = get_page_media_box(&doc, page_ids[0]).unwrap();
        assert_eq!(x1, 0.0);
        assert_eq!(y1, 0.0);
        assert_eq!(x2, 612.0);
        assert_eq!(y2, 792.0);
    }

    #[test]
    fn get_page_media_box_default_fallback() {
        // Page without MediaBox and no parent → falls back to US Letter
        let mut doc = Document::new();
        let mut page_dict = Dictionary::new();
        page_dict.set("Type", Object::Name(b"Page".to_vec()));
        let page_id = doc.add_object(Object::Dictionary(page_dict));
        let (x1, y1, x2, y2) = get_page_media_box(&doc, page_id).unwrap();
        assert_eq!((x1, y1, x2, y2), (0.0, 0.0, 612.0, 792.0));
    }

    #[test]
    fn get_page_media_box_parent_inheritance() {
        let mut doc = Document::new();
        // Parent with MediaBox
        let mut parent_dict = Dictionary::new();
        parent_dict.set("Type", Object::Name(b"Pages".to_vec()));
        parent_dict.set("MediaBox", Object::Array(vec![
            Object::Integer(0), Object::Integer(0),
            Object::Integer(595), Object::Integer(842),  // A4
        ]));
        let parent_id = doc.add_object(Object::Dictionary(parent_dict));
        // Child page without MediaBox
        let mut page_dict = Dictionary::new();
        page_dict.set("Type", Object::Name(b"Page".to_vec()));
        page_dict.set("Parent", Object::Reference(parent_id));
        let page_id = doc.add_object(Object::Dictionary(page_dict));
        let (_, _, x2, y2) = get_page_media_box(&doc, page_id).unwrap();
        assert_eq!(x2, 595.0);
        assert_eq!(y2, 842.0);
    }
}
