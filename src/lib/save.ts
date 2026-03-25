import type { Annotation } from "../types";
import { hexToColor, htmlToPlainText } from "./utils";

export interface AnnotationSaveData {
  annotation_type: string;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: [number, number, number];
}

export interface InkSaveData {
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  paths: number[][]; // each path is flat [x1,y1,x2,y2,...] in normalized coords
  color: [number, number, number];
  stroke_width: number;
}

export interface ShapeSaveData {
  page_number: number;
  shape: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: [number, number, number];
  stroke_width: number;
}

export interface TextSaveData {
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: [number, number, number];
  font_size: number;
  font_family: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  background_color: string;
}

export interface SignatureEmbedData {
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  image_base64: string;
}

export interface FormFieldSaveData {
  field_name: string;
  value: string;
  field_type: string;
}

export function toSaveData(annotations: Annotation[]): AnnotationSaveData[] {
  return annotations
    .filter((a) => a.type === "highlight" || a.type === "sticky-note" || a.type === "underline" || a.type === "strikethrough")
    .map((a) => {
      if (a.type === "highlight" || a.type === "underline" || a.type === "strikethrough") {
        return {
          annotation_type: a.type,
          page_number: a.pageNumber,
          x: a.x,
          y: a.y,
          width: a.width,
          height: a.height,
          text: "",
          color: hexToColor(a.color),
        };
      }
      const note = a as Extract<Annotation, { type: "sticky-note" }>;
      return {
        annotation_type: "sticky-note",
        page_number: note.pageNumber,
        x: note.x,
        y: note.y,
        width: 0,
        height: 0,
        text: note.text ?? "",
        color: hexToColor(note.color),
      };
    });
}

export function toInkSaveData(annotations: Annotation[]): InkSaveData[] {
  return annotations
    .filter((a) => a.type === "ink")
    .map((a) => {
      const ink = a as Extract<Annotation, { type: "ink" }>;
      return {
        page_number: ink.pageNumber,
        x: ink.x,
        y: ink.y,
        width: ink.width,
        height: ink.height,
        paths: ink.paths.map((stroke) => {
          const flat: number[] = [];
          for (const pt of stroke) {
            flat.push(pt.x, pt.y);
          }
          return flat;
        }),
        color: hexToColor(ink.color),
        stroke_width: ink.strokeWidth,
      };
    });
}

export function toShapeSaveData(annotations: Annotation[]): ShapeSaveData[] {
  return annotations
    .filter((a) => a.type === "shape")
    .map((a) => {
      const s = a as Extract<Annotation, { type: "shape" }>;
      return {
        page_number: s.pageNumber,
        shape: s.shape,
        x1: s.x1,
        y1: s.y1,
        x2: s.x2,
        y2: s.y2,
        color: hexToColor(s.color),
        stroke_width: s.strokeWidth,
      };
    });
}

export function toTextSaveData(annotations: Annotation[]): TextSaveData[] {
  return annotations
    .filter((a) => a.type === "text")
    .map((a) => {
      const t = a as Extract<Annotation, { type: "text" }>;
      return {
        page_number: t.pageNumber,
        x: t.x,
        y: t.y,
        width: t.width,
        height: t.height,
        text: htmlToPlainText(t.text),
        color: hexToColor(t.color),
        font_size: t.fontSize,
        font_family: t.fontFamily,
        bold: t.bold,
        italic: t.italic,
        underline: t.underline,
        background_color: t.backgroundColor,
      };
    });
}

export function toSignatureData(annotations: Annotation[]): SignatureEmbedData[] {
  return annotations
    .filter((a) => a.type === "signature")
    .map((a) => {
      const sig = a as Extract<Annotation, { type: "signature" }>;
      const base64 = sig.imageData.replace(/^data:image\/\w+;base64,/, "");
      return {
        page_number: sig.pageNumber,
        x: sig.x,
        y: sig.y,
        width: sig.width,
        height: sig.height,
        image_base64: base64,
      };
    });
}
