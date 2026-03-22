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

  return { ...state, openFile, openPath: loadPath };
}
