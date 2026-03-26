import { useEffect, useState } from "react";
import { getEngine } from "../lib/pdf";
import type { PdfDocument } from "../lib/pdf";
import type { PageDimension } from "../types";

interface PdfDocumentState {
  pdfDoc: PdfDocument | null;
  pageDimensions: PageDimension[];
  error: string | null;
}

export function usePdfDocument(data: Uint8Array | null) {
  const [state, setState] = useState<PdfDocumentState>({
    pdfDoc: null,
    pageDimensions: [],
    error: null,
  });

  useEffect(() => {
    if (!data) {
      setState({ pdfDoc: null, pageDimensions: [], error: null });
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const doc = await getEngine().loadDocument(data!.slice());
        if (cancelled) return;

        const dims: PageDimension[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const viewport = page.getViewport(1);
          dims.push({
            pageNumber: i,
            width: viewport.width,
            height: viewport.height,
          });
        }

        if (!cancelled) {
          setState({ pdfDoc: doc, pageDimensions: dims, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          console.error("Failed to load PDF document:", err);
          setState({ pdfDoc: null, pageDimensions: [], error: String(err) });
        }
      }
    }

    load();
    return () => { cancelled = true; };
  }, [data]);

  return state;
}
