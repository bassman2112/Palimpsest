import { useCallback, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { Annotation } from "../types";

interface PdfMetadata {
  pageCount: number;
  path: string;
}

interface AnnotationData {
  annotation_type: string;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: [number, number, number];
  paths?: number[][]; // flat [x1,y1,x2,y2,...] for ink annotations
  stroke_width?: number;
  shape?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  font_size?: number;
  font_family?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  background_color?: string;
}

interface PdfState {
  data: Uint8Array | null;
  metadata: PdfMetadata | null;
  loading: boolean;
  error: string | null;
  initialAnnotations: Annotation[];
}

function colorToHex(c: [number, number, number]): string {
  const r = Math.round(c[0] * 255);
  const g = Math.round(c[1] * 255);
  const b = Math.round(c[2] * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function convertAnnotationData(data: AnnotationData[]): Annotation[] {
  return data.map((d) => {
    const color = colorToHex(d.color);
    if (d.annotation_type === "highlight") {
      return {
        id: crypto.randomUUID(),
        type: "highlight" as const,
        pageNumber: d.page_number,
        x: d.x,
        y: d.y,
        width: d.width,
        height: d.height,
        color,
      };
    }
    if (d.annotation_type === "underline" || d.annotation_type === "strikethrough") {
      return {
        id: crypto.randomUUID(),
        type: d.annotation_type as "underline" | "strikethrough",
        pageNumber: d.page_number,
        x: d.x,
        y: d.y,
        width: d.width,
        height: d.height,
        color,
      };
    }
    if (d.annotation_type === "shape" && d.shape != null && d.x1 != null && d.y1 != null && d.x2 != null && d.y2 != null) {
      return {
        id: crypto.randomUUID(),
        type: "shape" as const,
        shape: d.shape as "rectangle" | "ellipse" | "line" | "arrow",
        pageNumber: d.page_number,
        x1: d.x1,
        y1: d.y1,
        x2: d.x2,
        y2: d.y2,
        color,
        strokeWidth: d.stroke_width ?? 2,
      };
    }
    if (d.annotation_type === "ink" && d.paths) {
      const paths = d.paths.map((flat) => {
        const points: Array<{ x: number; y: number }> = [];
        for (let i = 0; i < flat.length; i += 2) {
          points.push({ x: flat[i], y: flat[i + 1] });
        }
        return points;
      });
      return {
        id: crypto.randomUUID(),
        type: "ink" as const,
        pageNumber: d.page_number,
        x: d.x,
        y: d.y,
        width: d.width,
        height: d.height,
        paths,
        color,
        strokeWidth: d.stroke_width ?? 2,
      };
    }
    if (d.annotation_type === "text") {
      return {
        id: crypto.randomUUID(),
        type: "text" as const,
        pageNumber: d.page_number,
        x: d.x,
        y: d.y,
        width: d.width,
        height: d.height,
        text: d.text,
        color,
        fontSize: d.font_size ?? 16,
        fontFamily: d.font_family ?? "sans-serif",
        bold: d.bold ?? false,
        italic: d.italic ?? false,
        underline: d.underline ?? false,
        backgroundColor: d.background_color ?? "transparent",
      };
    }
    return {
      id: crypto.randomUUID(),
      type: "sticky-note" as const,
      pageNumber: d.page_number,
      x: d.x,
      y: d.y,
      text: d.text,
      color,
    };
  });
}

export function useFileOpen() {
  const [state, setState] = useState<PdfState>({
    data: null,
    metadata: null,
    loading: false,
    error: null,
    initialAnnotations: [],
  });

  const loadPath = useCallback(async (path: string) => {
    setState((s) => ({ ...s, loading: true, error: null }));

    try {
      const [b64, metadata] = await Promise.all([
        invoke<string>("read_pdf_bytes", { path }),
        invoke<PdfMetadata>("get_pdf_metadata", { path }),
      ]);

      let initialAnnotations: Annotation[] = [];
      try {
        const annotData = await invoke<AnnotationData[]>("read_annotations", { path });
        initialAnnotations = convertAnnotationData(annotData);
      } catch {
        // No annotations or unsupported — that's fine
      }

      const binary = atob(b64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }

      setState({ data: bytes, metadata, loading: false, error: null, initialAnnotations });
      return path;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Failed to open PDF:", err);
      setState((s) => ({ ...s, loading: false, error: message }));
      return null;
    }
  }, []);

  const openFile = useCallback(async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });

      if (!selected) return null;

      const path = typeof selected === "string" ? selected : String(selected);
      return loadPath(path);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Failed to open PDF:", err);
      setState((s) => ({ ...s, loading: false, error: message }));
      return null;
    }
  }, [loadPath]);

  const closeFile = useCallback(() => {
    setState({ data: null, metadata: null, loading: false, error: null, initialAnnotations: [] });
  }, []);

  return { ...state, openFile, openPath: loadPath, closeFile };
}
