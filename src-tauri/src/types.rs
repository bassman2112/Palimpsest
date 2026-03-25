use serde::{Deserialize, Serialize};
use std::sync::Mutex;

pub const MAX_RECENT_SLOTS: usize = 10;

pub struct RecentPaths(pub Mutex<Vec<String>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfMetadata {
    pub page_count: usize,
    pub path: String,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paths: Option<Vec<Vec<f64>>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stroke_width: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub shape: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x1: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y1: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub x2: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub y2: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_size: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub font_family: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bold: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub italic: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub underline: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub background_color: Option<String>,
}

#[derive(Deserialize)]
pub struct MergePageSpec {
    pub path: String,
    pub page_number: u32, // 1-indexed
}

#[derive(Deserialize)]
pub struct FormFieldUpdate {
    pub field_name: String,
    pub value: String,
    pub field_type: String, // "text", "checkbox", "radio", "choice"
}

#[derive(Deserialize)]
pub struct SignatureImageData {
    pub page_number: usize,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub image_base64: String, // JPEG data (no data URL prefix)
}

#[derive(Deserialize)]
pub struct InkAnnotationData {
    pub page_number: usize,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub paths: Vec<Vec<f64>>, // each is flat [x1,y1,x2,y2,...] in normalized coords
    pub color: [f64; 3],
    pub stroke_width: f64,
}

#[derive(Deserialize)]
pub struct TextAnnotationData {
    pub page_number: usize,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub text: String,
    pub color: [f64; 3],
    pub font_size: f64,
    pub font_family: String,  // "sans-serif" | "serif" | "monospace"
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub background_color: String,  // "transparent" or rgba color string
}

#[derive(Deserialize)]
pub struct ShapeAnnotationData {
    pub page_number: usize,
    pub shape: String,     // "rectangle" | "ellipse" | "line" | "arrow"
    pub x1: f64,
    pub y1: f64,
    pub x2: f64,
    pub y2: f64,
    pub color: [f64; 3],
    pub stroke_width: f64,
}
