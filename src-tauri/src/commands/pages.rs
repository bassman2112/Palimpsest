use lopdf::{Document, Object};

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
}
