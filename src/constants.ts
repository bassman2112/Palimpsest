// Drag & interaction thresholds
export const DRAG_THRESHOLD = 2;

// Minimum resize dimensions (normalized 0-1 space, applied as pixels at zoom=1)
export const MIN_RESIZE_DIM = 10;
export const MIN_SIGNATURE_WIDTH = 40;
export const MIN_SIGNATURE_HEIGHT = 20;
export const MIN_TEXT_WIDTH = 50;
export const MIN_TEXT_HEIGHT = 20;

// SVG/canvas padding (pixels)
export const INK_STROKE_PADDING = 4;
export const SHAPE_PADDING = 8;

// Default colors
export const DEFAULT_STICKY_COLOR = "#ffeb3b";
export const DEFAULT_HIGHLIGHT_COLOR = "#ffff00";
export const DEFAULT_TEXT_COLOR = "#000000";

// Default stroke width
export const DEFAULT_STROKE_WIDTH = 2;

// Default placement sizes (pixels, normalized before use)
export const DEFAULT_SIGNATURE_SIZE = { width: 150, height: 60 };
export const DEFAULT_TEXT_SIZE = { width: 50, height: 20 };

// Fit zoom padding (pixels)
export const FIT_ZOOM_PADDING = 48;

// Highlight color palette
export const HIGHLIGHT_COLORS = [
  { color: "#ffff00", label: "Yellow" },
  { color: "#ff6b6b", label: "Red" },
  { color: "#ffa500", label: "Orange" },
  { color: "#51cf66", label: "Green" },
  { color: "#339af0", label: "Blue" },
  { color: "#cc5de8", label: "Purple" },
  { color: "#f06595", label: "Pink" },
];
