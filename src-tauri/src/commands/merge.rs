use lopdf::{Document, Object, Dictionary, ObjectId};
use std::collections::{HashMap, HashSet, VecDeque};

use crate::types::MergePageSpec;

/// BFS to collect all ObjectIds reachable from `start_id`, skipping `/Parent` keys.
pub(crate) fn collect_reachable(doc: &Document, start_id: ObjectId) -> Vec<ObjectId> {
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

pub(crate) fn collect_refs_from_object(
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

/// Recursively rewrite all Object::Reference(old) -> Object::Reference(new) using the mapping.
pub(crate) fn remap_references(obj: &mut Object, map: &HashMap<ObjectId, ObjectId>) {
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
pub(crate) fn import_page(
    target: &mut Document,
    source: &Document,
    page_id: ObjectId,
    target_pages_id: ObjectId,
) -> Result<ObjectId, String> {
    let reachable = collect_reachable(source, page_id);

    // Deep-copy each reachable object into target, building old->new mapping
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
pub fn merge_pdfs(pages: Vec<MergePageSpec>, dest: String) -> Result<(), String> {
    if pages.is_empty() {
        return Err("No pages to merge".into());
    }

    // Deduplicate source paths -> load each document once
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
