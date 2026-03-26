use lopdf::{Document, Object, Dictionary, Stream};

use super::merge;

#[tauri::command]
pub fn reorder_page(path: String, from: u32, to: u32) -> Result<(), String> {
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
pub fn reorder_pages(path: String, pages: Vec<u32>, insert_before: u32) -> Result<(), String> {
    let mut doc = Document::load(&path).map_err(|e| format!("Failed to load PDF: {}", e))?;
    let total = doc.get_pages().len() as u32;

    for &p in &pages {
        if p < 1 || p > total {
            return Err(format!("Page {} out of range (1-{})", p, total));
        }
    }
    if insert_before < 1 || insert_before > total + 1 {
        return Err(format!("Insert position {} out of range (1-{})", insert_before, total + 1));
    }

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

    // Collect the page indices to move (0-based), sorted descending for safe removal
    let indices: Vec<usize> = pages.iter().map(|&p| (p - 1) as usize).collect();
    // Extract the items (remove from highest index first to preserve lower indices)
    let mut sorted_desc = indices.clone();
    sorted_desc.sort_unstable_by(|a, b| b.cmp(a));
    let mut extracted: Vec<(usize, Object)> = Vec::new();
    for idx in sorted_desc {
        let item = kids_arr.remove(idx);
        extracted.push((idx, item));
    }
    // Re-order extracted items to match the original `pages` order
    let items: Vec<Object> = indices.iter().map(|idx| {
        extracted.iter()
            .find(|(i, _)| i == idx)
            .ok_or("Page not found in extracted items")
            .map(|(_, obj)| obj.clone())
    }).collect::<Result<Vec<_>, _>>()
    .map_err(|e| e.to_string())?;

    // Compute insertion point: how many pages before insert_before were NOT moved?
    let insert_idx = (insert_before - 1) as usize;
    let moved_set: std::collections::HashSet<usize> = indices.iter().copied().collect();
    let adjusted = (0..insert_idx).filter(|i| !moved_set.contains(i)).count();

    // Insert all items at the adjusted position
    for (i, item) in items.into_iter().enumerate() {
        kids_arr.insert(adjusted + i, item);
    }

    doc.save(&path).map_err(|e| format!("Failed to save PDF: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn set_page_order(path: String, order: Vec<u32>) -> Result<(), String> {
    let mut doc = Document::load(&path).map_err(|e| format!("Failed to load PDF: {}", e))?;
    let total = doc.get_pages().len() as u32;
    if order.len() != total as usize {
        return Err(format!("Order has {} entries but PDF has {} pages", order.len(), total));
    }

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

    let original: Vec<Object> = kids_arr.clone();
    kids_arr.clear();
    for &page_num in &order {
        let idx = (page_num - 1) as usize;
        if idx >= original.len() {
            return Err(format!("Page {} out of range", page_num));
        }
        kids_arr.push(original[idx].clone());
    }

    doc.save(&path).map_err(|e| format!("Failed to save PDF: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn delete_pages(path: String, page_numbers: Vec<u32>) -> Result<(), String> {
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

#[tauri::command]
pub fn rotate_pages(path: String, page_numbers: Vec<u32>, degrees: i32) -> Result<(), String> {
    let mut doc = Document::load(&path).map_err(|e| format!("Failed to load PDF: {}", e))?;
    let pages = doc.get_pages();
    let total = pages.len() as u32;

    for &p in &page_numbers {
        if p < 1 || p > total {
            return Err(format!("Page {} out of range (1-{})", p, total));
        }
    }

    // Collect page object IDs for target pages
    let page_ids: Vec<lopdf::ObjectId> = page_numbers
        .iter()
        .map(|&p| pages.get(&p).copied().ok_or_else(|| format!("Page {} not found", p)))
        .collect::<Result<Vec<_>, _>>()?;

    for page_id in page_ids {
        let page_obj = doc
            .get_object_mut(page_id)
            .map_err(|e| format!("Failed to get page object: {}", e))?;
        let dict = page_obj
            .as_dict_mut()
            .map_err(|e| format!("Page is not a dict: {}", e))?;

        let current = dict
            .get(b"Rotate")
            .ok()
            .and_then(|o| match o {
                Object::Integer(n) => Some(*n as i32),
                _ => None,
            })
            .unwrap_or(0);

        let new_rotation = ((current + degrees) % 360 + 360) % 360;
        dict.set("Rotate", Object::Integer(new_rotation as i64));
    }

    doc.save(&path).map_err(|e| format!("Failed to save PDF: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn extract_pages(path: String, page_numbers: Vec<u32>, dest: String) -> Result<(), String> {
    if page_numbers.is_empty() {
        return Err("No pages to extract".into());
    }
    let source = Document::load(&path).map_err(|e| format!("Failed to load PDF: {}", e))?;
    let source_pages = source.get_pages();

    let mut target = Document::with_version("1.7");
    let pages_dict = Dictionary::from_iter(vec![
        ("Type", Object::Name(b"Pages".to_vec())),
        ("Kids", Object::Array(vec![])),
        ("Count", Object::Integer(0)),
    ]);
    let pages_id = target.add_object(Object::Dictionary(pages_dict));
    let catalog_dict = Dictionary::from_iter(vec![
        ("Type", Object::Name(b"Catalog".to_vec())),
        ("Pages", Object::Reference(pages_id)),
    ]);
    let catalog_id = target.add_object(Object::Dictionary(catalog_dict));
    target.trailer.set("Root", Object::Reference(catalog_id));

    let mut kids: Vec<Object> = Vec::new();
    for &pn in &page_numbers {
        let page_obj_id = source_pages
            .get(&pn)
            .ok_or_else(|| format!("Page {} not found (PDF has {} pages)", pn, source_pages.len()))?;
        let new_page_id = merge::import_page(&mut target, &source, *page_obj_id, pages_id)?;
        kids.push(Object::Reference(new_page_id));
    }

    if let Ok(obj) = target.get_object_mut(pages_id) {
        if let Ok(dict) = obj.as_dict_mut() {
            dict.set("Kids", Object::Array(kids.clone()));
            dict.set("Count", Object::Integer(kids.len() as i64));
        }
    }

    target.renumber_objects();
    target.compress();
    target.save(&dest).map_err(|e| format!("Failed to save extracted PDF: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn split_pdf(
    path: String,
    after_page: u32,
    dest_first: String,
    dest_second: String,
) -> Result<(), String> {
    let source = Document::load(&path).map_err(|e| format!("Failed to load PDF: {}", e))?;
    let source_pages = source.get_pages();
    let total = source_pages.len() as u32;

    if after_page < 1 || after_page >= total {
        return Err(format!("after_page must be between 1 and {} (exclusive)", total));
    }

    // Helper: build a new doc from a range of pages
    let build_part = |range: std::ops::RangeInclusive<u32>| -> Result<Document, String> {
        let mut target = Document::with_version("1.7");
        let pages_dict = Dictionary::from_iter(vec![
            ("Type", Object::Name(b"Pages".to_vec())),
            ("Kids", Object::Array(vec![])),
            ("Count", Object::Integer(0)),
        ]);
        let pages_id = target.add_object(Object::Dictionary(pages_dict));
        let catalog_dict = Dictionary::from_iter(vec![
            ("Type", Object::Name(b"Catalog".to_vec())),
            ("Pages", Object::Reference(pages_id)),
        ]);
        let catalog_id = target.add_object(Object::Dictionary(catalog_dict));
        target.trailer.set("Root", Object::Reference(catalog_id));

        let mut kids: Vec<Object> = Vec::new();
        for pn in range {
            let page_obj_id = source_pages
                .get(&pn)
                .ok_or_else(|| format!("Page {} not found", pn))?;
            let new_page_id = merge::import_page(&mut target, &source, *page_obj_id, pages_id)?;
            kids.push(Object::Reference(new_page_id));
        }

        if let Ok(obj) = target.get_object_mut(pages_id) {
            if let Ok(dict) = obj.as_dict_mut() {
                dict.set("Kids", Object::Array(kids.clone()));
                dict.set("Count", Object::Integer(kids.len() as i64));
            }
        }
        target.renumber_objects();
        target.compress();
        Ok(target)
    };

    let mut first = build_part(1..=after_page)?;
    first.save(&dest_first).map_err(|e| format!("Failed to save first part: {}", e))?;

    let mut second = build_part((after_page + 1)..=total)?;
    second.save(&dest_second).map_err(|e| format!("Failed to save second part: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn insert_blank_page(path: String, after_page: u32, width: f64, height: f64) -> Result<(), String> {
    let mut doc = Document::load(&path).map_err(|e| format!("Failed to load PDF: {}", e))?;
    let total = doc.get_pages().len() as u32;
    if after_page > total {
        return Err(format!("after_page {} out of range (0-{})", after_page, total));
    }

    let catalog = doc.catalog().map_err(|e| format!("No catalog: {}", e))?.clone();
    let pages_ref = catalog.get(b"Pages").map_err(|e| format!("No Pages: {}", e))?;
    let pages_id = match pages_ref {
        Object::Reference(id) => *id,
        _ => return Err("Pages is not a reference".into()),
    };

    let mut page_dict = Dictionary::new();
    page_dict.set("Type", Object::Name(b"Page".to_vec()));
    page_dict.set("Parent", Object::Reference(pages_id));
    page_dict.set("MediaBox", Object::Array(vec![
        Object::Integer(0), Object::Integer(0),
        Object::Real(width as f32), Object::Real(height as f32),
    ]));
    let page_id = doc.add_object(Object::Dictionary(page_dict));

    let pages_obj = doc.get_object_mut(pages_id).map_err(|e| format!("Failed to get Pages: {}", e))?;
    let dict = pages_obj.as_dict_mut().map_err(|e| format!("Pages not a dict: {}", e))?;
    let kids = dict.get_mut(b"Kids").map_err(|e| format!("No Kids: {}", e))?;
    let kids_arr = match kids {
        Object::Array(ref mut arr) => arr,
        _ => return Err("Kids is not an array".into()),
    };
    kids_arr.insert(after_page as usize, Object::Reference(page_id));

    let new_count = kids_arr.len() as i64;
    let pages_obj2 = doc.get_object_mut(pages_id).map_err(|e| format!("Failed: {}", e))?;
    let dict2 = pages_obj2.as_dict_mut().map_err(|e| format!("Failed: {}", e))?;
    dict2.set("Count", Object::Integer(new_count));

    doc.save(&path).map_err(|e| format!("Failed to save PDF: {}", e))?;
    Ok(())
}

#[tauri::command]
pub fn insert_image_page(path: String, after_page: u32, image_base64: String) -> Result<(), String> {
    use base64::Engine;

    let image_bytes = base64::engine::general_purpose::STANDARD
        .decode(&image_base64)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // Read image dimensions
    let reader = image::ImageReader::new(std::io::Cursor::new(&image_bytes))
        .with_guessed_format()
        .map_err(|e| format!("Failed to read image format: {}", e))?;
    let img = reader.decode().map_err(|e| format!("Failed to decode image: {}", e))?;
    let img_w = img.width();
    let img_h = img.height();

    // Re-encode as JPEG to avoid PNG alpha complexity
    let mut jpeg_buf = std::io::Cursor::new(Vec::new());
    img.write_to(&mut jpeg_buf, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode JPEG: {}", e))?;
    let jpeg_bytes = jpeg_buf.into_inner();

    let mut doc = Document::load(&path).map_err(|e| format!("Failed to load PDF: {}", e))?;
    let total = doc.get_pages().len() as u32;
    if after_page > total {
        return Err(format!("after_page {} out of range (0-{})", after_page, total));
    }

    // Create Image XObject (DCTDecode = JPEG)
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

    // Page size = image size in points (1px = 1pt)
    let page_w = img_w as f64;
    let page_h = img_h as f64;

    // Content stream: draw image scaled to full page
    let content = format!("q {} 0 0 {} 0 0 cm /Img Do Q", page_w, page_h);
    let content_stream = Stream::new(Dictionary::new(), content.into_bytes());
    let content_id = doc.add_object(Object::Stream(content_stream));

    // Resources with XObject reference
    let mut xobject_dict = Dictionary::new();
    xobject_dict.set("Img", Object::Reference(img_id));
    let mut resources = Dictionary::new();
    resources.set("XObject", Object::Dictionary(xobject_dict));

    let catalog = doc.catalog().map_err(|e| format!("No catalog: {}", e))?.clone();
    let pages_ref = catalog.get(b"Pages").map_err(|e| format!("No Pages: {}", e))?;
    let pages_id = match pages_ref {
        Object::Reference(id) => *id,
        _ => return Err("Pages is not a reference".into()),
    };

    // Create page dict
    let mut page_dict = Dictionary::new();
    page_dict.set("Type", Object::Name(b"Page".to_vec()));
    page_dict.set("Parent", Object::Reference(pages_id));
    page_dict.set("MediaBox", Object::Array(vec![
        Object::Integer(0), Object::Integer(0),
        Object::Real(page_w as f32), Object::Real(page_h as f32),
    ]));
    page_dict.set("Contents", Object::Reference(content_id));
    page_dict.set("Resources", Object::Dictionary(resources));
    let page_id = doc.add_object(Object::Dictionary(page_dict));

    // Insert into Kids array
    let pages_obj = doc.get_object_mut(pages_id).map_err(|e| format!("Failed to get Pages: {}", e))?;
    let dict = pages_obj.as_dict_mut().map_err(|e| format!("Pages not a dict: {}", e))?;
    let kids = dict.get_mut(b"Kids").map_err(|e| format!("No Kids: {}", e))?;
    let kids_arr = match kids {
        Object::Array(ref mut arr) => arr,
        _ => return Err("Kids is not an array".into()),
    };
    kids_arr.insert(after_page as usize, Object::Reference(page_id));

    let new_count = kids_arr.len() as i64;
    let pages_obj2 = doc.get_object_mut(pages_id).map_err(|e| format!("Failed: {}", e))?;
    let dict2 = pages_obj2.as_dict_mut().map_err(|e| format!("Failed: {}", e))?;
    dict2.set("Count", Object::Integer(new_count));

    doc.save(&path).map_err(|e| format!("Failed to save PDF: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{Document, Object, Dictionary};
    use std::collections::BTreeMap;
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    /// Build a minimal valid PDF with `n` pages and save to a temp file.
    /// Returns the file path.
    fn build_temp_pdf(n: usize) -> String {
        let mut doc = Document::new();
        let pages_id = doc.new_object_id();

        let mut kids: Vec<Object> = Vec::new();
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

        let count = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "palimpsest_test_{}_{}.pdf", std::process::id(), count
        ));
        doc.save(&path).unwrap();
        path.to_string_lossy().to_string()
    }

    /// Get the ordered page object IDs from a saved PDF
    fn get_page_ids(path: &str) -> Vec<lopdf::ObjectId> {
        let doc = Document::load(path).unwrap();
        let pages: BTreeMap<u32, lopdf::ObjectId> = doc.get_pages();
        let mut sorted: Vec<(u32, lopdf::ObjectId)> = pages.into_iter().collect();
        sorted.sort_by_key(|(k, _)| *k);
        sorted.into_iter().map(|(_, id)| id).collect()
    }

    #[test]
    fn reorder_page_move_2_to_4() {
        let path = build_temp_pdf(5);
        let original = get_page_ids(&path);
        reorder_page(path.clone(), 2, 4).unwrap();
        let reordered = get_page_ids(&path);
        // Page 2 (index 1) moved to position 4 (index 3)
        // Original: [1, 2, 3, 4, 5]
        // After remove(1): [1, 3, 4, 5], insert(3, 2): [1, 3, 4, 2, 5]
        assert_eq!(reordered[0], original[0]); // page 1 stays
        assert_eq!(reordered[1], original[2]); // page 3
        assert_eq!(reordered[2], original[3]); // page 4
        assert_eq!(reordered[3], original[1]); // page 2 moved here
        assert_eq!(reordered[4], original[4]); // page 5 stays
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn reorder_page_move_4_to_1() {
        let path = build_temp_pdf(5);
        let original = get_page_ids(&path);
        reorder_page(path.clone(), 4, 1).unwrap();
        let reordered = get_page_ids(&path);
        // Remove index 3, insert at index 0: [4, 1, 2, 3, 5]
        assert_eq!(reordered[0], original[3]); // page 4 moved to front
        assert_eq!(reordered[1], original[0]); // page 1
        assert_eq!(reordered[2], original[1]); // page 2
        assert_eq!(reordered[3], original[2]); // page 3
        assert_eq!(reordered[4], original[4]); // page 5
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn set_page_order_full_permutation() {
        let path = build_temp_pdf(5);
        let original = get_page_ids(&path);
        set_page_order(path.clone(), vec![3, 1, 4, 2, 5]).unwrap();
        let reordered = get_page_ids(&path);
        assert_eq!(reordered[0], original[2]); // was page 3
        assert_eq!(reordered[1], original[0]); // was page 1
        assert_eq!(reordered[2], original[3]); // was page 4
        assert_eq!(reordered[3], original[1]); // was page 2
        assert_eq!(reordered[4], original[4]); // was page 5
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn delete_pages_removes_correct_pages() {
        let path = build_temp_pdf(5);
        let original = get_page_ids(&path);
        delete_pages(path.clone(), vec![2, 3]).unwrap();
        let remaining = get_page_ids(&path);
        assert_eq!(remaining.len(), 3);
        assert_eq!(remaining[0], original[0]); // page 1
        assert_eq!(remaining[1], original[3]); // page 4
        assert_eq!(remaining[2], original[4]); // page 5
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn delete_pages_keep_one() {
        let path = build_temp_pdf(3);
        delete_pages(path.clone(), vec![1, 3]).unwrap();
        let remaining = get_page_ids(&path);
        assert_eq!(remaining.len(), 1);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn delete_all_pages_fails() {
        let path = build_temp_pdf(2);
        let result = delete_pages(path.clone(), vec![1, 2]);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Cannot delete all pages"));
        std::fs::remove_file(&path).ok();
    }

    /// Helper: read the /Rotate value of a given page (1-based)
    fn get_page_rotation(path: &str, page_num: u32) -> i32 {
        let doc = Document::load(path).unwrap();
        let pages = doc.get_pages();
        let page_id = pages.get(&page_num).unwrap();
        let page_obj = doc.get_object(*page_id).unwrap();
        let dict = page_obj.as_dict().unwrap();
        dict.get(b"Rotate")
            .ok()
            .and_then(|o| match o {
                Object::Integer(n) => Some(*n as i32),
                _ => None,
            })
            .unwrap_or(0)
    }

    #[test]
    fn rotate_page_90_clockwise() {
        let path = build_temp_pdf(3);
        rotate_pages(path.clone(), vec![2], 90).unwrap();
        assert_eq!(get_page_rotation(&path, 1), 0);
        assert_eq!(get_page_rotation(&path, 2), 90);
        assert_eq!(get_page_rotation(&path, 3), 0);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn rotate_page_cumulative() {
        let path = build_temp_pdf(2);
        rotate_pages(path.clone(), vec![1], 90).unwrap();
        rotate_pages(path.clone(), vec![1], 90).unwrap();
        assert_eq!(get_page_rotation(&path, 1), 180);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn rotate_page_wrap_360() {
        let path = build_temp_pdf(2);
        rotate_pages(path.clone(), vec![1], 270).unwrap();
        rotate_pages(path.clone(), vec![1], 90).unwrap();
        assert_eq!(get_page_rotation(&path, 1), 0);
        std::fs::remove_file(&path).ok();
    }

    fn temp_path(suffix: &str) -> String {
        let count = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = std::env::temp_dir().join(format!(
            "palimpsest_test_{}_{}_{}.pdf", std::process::id(), count, suffix
        ));
        path.to_string_lossy().to_string()
    }

    #[test]
    fn extract_pages_subset() {
        let path = build_temp_pdf(5);
        let dest = temp_path("extract");
        extract_pages(path.clone(), vec![2, 4], dest.clone()).unwrap();
        let doc = Document::load(&dest).unwrap();
        assert_eq!(doc.get_pages().len(), 2);
        std::fs::remove_file(&path).ok();
        std::fs::remove_file(&dest).ok();
    }

    #[test]
    fn split_pdf_middle() {
        let path = build_temp_pdf(5);
        let dest1 = temp_path("split1");
        let dest2 = temp_path("split2");
        split_pdf(path.clone(), 2, dest1.clone(), dest2.clone()).unwrap();
        let doc1 = Document::load(&dest1).unwrap();
        let doc2 = Document::load(&dest2).unwrap();
        assert_eq!(doc1.get_pages().len(), 2);
        assert_eq!(doc2.get_pages().len(), 3);
        std::fs::remove_file(&path).ok();
        std::fs::remove_file(&dest1).ok();
        std::fs::remove_file(&dest2).ok();
    }

    #[test]
    fn insert_blank_page_middle() {
        let path = build_temp_pdf(3);
        insert_blank_page(path.clone(), 2, 612.0, 792.0).unwrap();
        let doc = Document::load(&path).unwrap();
        assert_eq!(doc.get_pages().len(), 4);
        std::fs::remove_file(&path).ok();
    }

    #[test]
    fn insert_image_page_test() {
        use base64::Engine;

        let path = build_temp_pdf(2);

        // Create a minimal 2x2 JPEG in memory using the image crate
        let img = image::RgbImage::from_fn(2, 2, |_, _| image::Rgb([255u8, 0, 0]));
        let mut buf = std::io::Cursor::new(Vec::new());
        img.write_to(&mut buf, image::ImageFormat::Jpeg).unwrap();
        let b64 = base64::engine::general_purpose::STANDARD.encode(buf.into_inner());

        insert_image_page(path.clone(), 1, b64).unwrap();
        let doc = Document::load(&path).unwrap();
        assert_eq!(doc.get_pages().len(), 3);
        std::fs::remove_file(&path).ok();
    }
}
