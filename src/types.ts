import type { PdfDocument } from "./lib/pdf";

export interface PageDimension {
  pageNumber: number;
  width: number;
  height: number;
}

export type AnnotationTool = "none" | "highlight" | "sticky-note" | "signature";

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

export type Annotation = HighlightAnnotation | StickyNoteAnnotation | SignatureAnnotation;

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
