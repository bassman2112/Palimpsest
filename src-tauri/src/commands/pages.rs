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
