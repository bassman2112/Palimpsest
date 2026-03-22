export interface PageDimension {
  pageNumber: number;
  width: number;
  height: number;
}

export type AnnotationTool = "none" | "highlight" | "sticky-note";

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

export type Annotation = HighlightAnnotation | StickyNoteAnnotation;
