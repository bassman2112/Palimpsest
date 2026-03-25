import type { PdfDocument } from "./lib/pdf";

export interface PageDimension {
  pageNumber: number;
  width: number;
  height: number;
}

export type AnnotationTool = "none" | "highlight" | "sticky-note" | "text" | "signature" | "underline" | "strikethrough" | "ink" | "shape-rectangle" | "shape-ellipse" | "shape-line" | "shape-arrow";

export interface HighlightAnnotation {
  id: string;
  type: "highlight";
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface StickyNoteAnnotation {
  id: string;
  type: "sticky-note";
  pageNumber: number;
  x: number;
  y: number;
  text: string;
  color: string;
}

export interface SignatureAnnotation {
  id: string;
  type: "signature";
  pageNumber: number;
  x: number;       // normalized 0-1
  y: number;       // normalized 0-1
  width: number;   // normalized 0-1
  height: number;  // normalized 0-1
  imageData: string; // data URL (JPEG with white background)
}

export interface TextMarkupAnnotation {
  id: string;
  type: "underline" | "strikethrough";
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
}

export interface InkAnnotation {
  id: string;
  type: "ink";
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  paths: Array<Array<{ x: number; y: number }>>; // normalized page coords
  color: string;
  strokeWidth: number; // logical pixels, scaled by zoom at render
}

export interface TextAnnotation {
  id: string;
  type: "text";
  pageNumber: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: string;
  fontSize: number;
  fontFamily: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  backgroundColor: string; // "transparent" or rgba color
}

export type ShapeKind = "rectangle" | "ellipse" | "line" | "arrow";

export interface ShapeAnnotation {
  id: string;
  type: "shape";
  shape: ShapeKind;
  pageNumber: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  strokeWidth: number;
}

export type Annotation = HighlightAnnotation | StickyNoteAnnotation | TextAnnotation | SignatureAnnotation | TextMarkupAnnotation | InkAnnotation | ShapeAnnotation;

export interface MergeSource {
  path: string;
  fileName: string;
  pdfDoc: PdfDocument;
  pageDimensions: PageDimension[];
}

export interface MergePage {
  id: string;                // unique key: `${sourceIndex}:${sourcePageNumber}`
  sourceIndex: number;       // index in sources array
  sourcePath: string;
  sourceFileName: string;
  sourcePageNumber: number;  // 1-indexed within source
  pdfDoc: PdfDocument;
  dimension: PageDimension;
}
