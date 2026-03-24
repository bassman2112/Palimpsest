import { useCallback, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { getEngine } from "../lib/pdf";
import type { PdfDocument } from "../lib/pdf";
import type { MergeSource, MergePage, PageDimension } from "../types";

const MAX_UNDO = 50;

interface MergeState {
  sources: MergeSource[];
  mergePages: MergePage[];
}

function buildMergePages(source: MergeSource, sourceIndex: number): MergePage[] {
  return source.pageDimensions.map((dim) => ({
    id: `${sourceIndex}:${dim.pageNumber}`,
    sourceIndex,
    sourcePath: source.path,
    sourceFileName: source.fileName,
    sourcePageNumber: dim.pageNumber,
    pdfDoc: source.pdfDoc,
    dimension: dim,
  }));
}

async function loadPdfFromPath(path: string): Promise<{ pdfDoc: PdfDocument; pageDimensions: PageDimension[] }> {
  const b64 = await invoke<string>("read_pdf_bytes", { path });
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const pdfDoc = await getEngine().loadDocument(bytes);

  const dims: PageDimension[] = [];
  for (let i = 1; i <= pdfDoc.numPages; i++) {
    const page = await pdfDoc.getPage(i);
    const viewport = page.getViewport(1);
    dims.push({ pageNumber: i, width: viewport.width, height: viewport.height });
  }

  return { pdfDoc, pageDimensions: dims };
}

export function useMergeDocuments() {
  const [state, setState] = useState<MergeState>({ sources: [], mergePages: [] });
  const undoStackRef = useRef<MergePage[][]>([]);

  const isMerging = state.sources.length > 0;

  const pushUndo = useCallback((pages: MergePage[]) => {
    undoStackRef.current.push(pages);
    if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
  }, []);

  const undo = useCallback((): boolean => {
    const prev = undoStackRef.current.pop();
    if (!prev) return false;
    setState((s) => ({ ...s, mergePages: prev }));
    return true;
  }, []);

  const enterMerge = useCallback((source: MergeSource) => {
    const pages = buildMergePages(source, 0);
    undoStackRef.current = [];
    setState({ sources: [source], mergePages: pages });
  }, []);

  const addDocumentByPath = useCallback(async (path: string) => {
    const { pdfDoc, pageDimensions } = await loadPdfFromPath(path);
    const fileName = path.split(/[\\/]/).pop() ?? path;
    const newSource: MergeSource = { path, fileName, pdfDoc, pageDimensions };

    setState((prev) => {
      pushUndo(prev.mergePages);
      const sourceIndex = prev.sources.length;
      const newPages = buildMergePages(newSource, sourceIndex);
      return {
        sources: [...prev.sources, newSource],
        mergePages: [...prev.mergePages, ...newPages],
      };
    });
  }, [pushUndo]);

  const addDocument = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "PDF", extensions: ["pdf"] }],
    });
    if (!selected) return;
    const path = typeof selected === "string" ? selected : String(selected);
    await addDocumentByPath(path);
  }, [addDocumentByPath]);

  const removePage = useCallback((pageId: string) => {
    setState((prev) => {
      pushUndo(prev.mergePages);
      return {
        ...prev,
        mergePages: prev.mergePages.filter((p) => p.id !== pageId),
      };
    });
  }, [pushUndo]);

  const removePages = useCallback((pageIds: string[]) => {
    const idSet = new Set(pageIds);
    setState((prev) => {
      pushUndo(prev.mergePages);
      return {
        ...prev,
        mergePages: prev.mergePages.filter((p) => !idSet.has(p.id)),
      };
    });
  }, [pushUndo]);

  const reorderPage = useCallback((fromIndex: number, toIndex: number) => {
    setState((prev) => {
      pushUndo(prev.mergePages);
      const pages = [...prev.mergePages];
      const [item] = pages.splice(fromIndex, 1);
      pages.splice(toIndex, 0, item);
      return { ...prev, mergePages: pages };
    });
  }, [pushUndo]);

  /** Move multiple pages (by ID) to `insertBefore` index (in the original array).
   *  Selected pages keep their relative order. */
  const reorderPages = useCallback((pageIds: string[], insertBefore: number) => {
    const idSet = new Set(pageIds);
    setState((prev) => {
      pushUndo(prev.mergePages);
      const moving = prev.mergePages.filter((p) => idSet.has(p.id));
      const remaining = prev.mergePages.filter((p) => !idSet.has(p.id));
      // Adjust insertion index: subtract selected items that were before it
      let adjusted = insertBefore;
      for (let i = 0; i < insertBefore && i < prev.mergePages.length; i++) {
        if (idSet.has(prev.mergePages[i].id)) adjusted--;
      }
      remaining.splice(Math.min(adjusted, remaining.length), 0, ...moving);
      return { ...prev, mergePages: remaining };
    });
  }, [pushUndo]);

  const clearMerge = useCallback(() => {
    undoStackRef.current = [];
    setState({ sources: [], mergePages: [] });
  }, []);

  return {
    sources: state.sources,
    mergePages: state.mergePages,
    isMerging,
    enterMerge,
    addDocument,
    addDocumentByPath,
    removePage,
    removePages,
    reorderPage,
    reorderPages,
    clearMerge,
    undo,
  };
}
