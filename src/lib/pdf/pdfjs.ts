// Polyfill ReadableStream async iteration for WebKit (Tauri WKWebView).
// PDF.js v5 uses `for await...of` on ReadableStream internally, which
// Safari/WebKit doesn't support. Without this, getTextContent() and
// TextLayer both crash.
if (
  typeof ReadableStream !== "undefined" &&
  !(Symbol.asyncIterator in ReadableStream.prototype)
) {
  (ReadableStream.prototype as any)[Symbol.asyncIterator] = async function* () {
    const reader = this.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
}

import * as pdfjsLib from "pdfjs-dist";
import { TextLayer, AnnotationLayer } from "pdfjs-dist";
import type {
  PdfDocument,
  PdfPage,
  PdfViewport,
  PdfRenderTask,
  PdfLayerHandle,
  PdfTextItem,
  PdfEngine,
} from "./types";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

class PdfJsDocument implements PdfDocument {
  constructor(private readonly _doc: import("pdfjs-dist").PDFDocumentProxy) {}

  get numPages(): number {
    return this._doc.numPages;
  }

  get annotationStorage(): unknown {
    return this._doc.annotationStorage;
  }

  async getPage(pageNumber: number): Promise<PdfPage> {
    const page = await this._doc.getPage(pageNumber);
    return new PdfJsPage(page, pageNumber, this._doc.annotationStorage);
  }

  getFormData(): Record<string, { value: string; type?: string }> | null {
    const storage = this._doc.annotationStorage as any;
    if (!storage) return null;
    const allData = storage.getAll?.() ?? storage.serializable;
    if (!allData) return null;

    const result: Record<string, { value: string; type?: string }> = {};
    for (const [key, val] of Object.entries(allData)) {
      if (val && typeof val === "object" && "value" in val) {
        const v = val as any;
        result[key] = {
          value: String(v.value ?? ""),
          type: v.type ?? undefined,
        };
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  onFormModified(callback: () => void): () => void {
    const storage = this._doc.annotationStorage as any;
    if (!storage) return () => {};
    storage.onSetModified = callback;
    return () => {
      if (storage.onSetModified === callback) {
        storage.onSetModified = null;
      }
    };
  }

  async destroy(): Promise<void> {
    await this._doc.destroy();
  }
}

class PdfJsPage implements PdfPage {
  constructor(
    private readonly _page: import("pdfjs-dist").PDFPageProxy,
    readonly pageNumber: number,
    private readonly _annotationStorage: any,
  ) {}

  getViewport(scale: number): PdfViewport {
    const vp = this._page.getViewport({ scale });
    return { width: vp.width, height: vp.height, _raw: vp };
  }

  renderToCanvas(
    canvas: HTMLCanvasElement,
    viewport: PdfViewport,
    options?: { devicePixelRatio?: number },
  ): PdfRenderTask {
    const dpr = options?.devicePixelRatio ?? 1;
    const rawViewport = viewport._raw as any;
    canvas.width = Math.floor(rawViewport.width * dpr);
    canvas.height = Math.floor(rawViewport.height * dpr);
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const task = this._page.render({ canvas, viewport: rawViewport } as any);
    return {
      promise: task.promise,
      cancel() {
        task.cancel();
      },
    };
  }

  renderTextLayer(container: HTMLElement, viewport: PdfViewport): PdfLayerHandle {
    let instance: TextLayer | null = null;
    let cancelled = false;

    const promise = (async () => {
      const textContent = await this._page.getTextContent();
      if (cancelled) return;
      instance = new TextLayer({
        textContentSource: textContent,
        container,
        viewport: viewport._raw as any,
      });
      await instance.render();
    })();

    return {
      promise,
      cancel() {
        cancelled = true;
        if (instance) {
          try {
            instance.cancel();
          } catch {}
        }
      },
    };
  }

  renderAnnotationLayer(
    container: HTMLElement,
    viewport: PdfViewport,
    options?: { renderForms?: boolean },
  ): PdfLayerHandle {
    let cancelled = false;

    const promise = (async () => {
      const allAnnotations = await this._page.getAnnotations();
      if (cancelled) return;

      // Filter out Text (sticky notes) and Highlight annotations — these are
      // rendered by the custom AnnotationOverlay, not PDF.js's AnnotationLayer.
      // Keeps links, form widgets, and other annotation types intact.
      const pdfAnnotations = allAnnotations.filter(
        (a: any) => a.subtype !== "Text" && a.subtype !== "Highlight"
      );

      const linkService = {
        getDestinationHash: () => "#",
        getAnchorUrl: (url: string) => url,
        addLinkAttributes: (link: HTMLAnchorElement, url: string) => {
          link.href = url;
          link.target = "_blank";
          link.rel = "noopener noreferrer nofollow";
        },
        isPageVisible: () => true,
        isPageCached: () => true,
        externalLinkEnabled: true,
        externalLinkTarget: 2,
        externalLinkRel: "noopener noreferrer nofollow",
      };

      const annotLayer = new AnnotationLayer({
        div: container,
        accessibilityManager: null,
        annotationCanvasMap: null,
        annotationEditorUIManager: null,
        page: this._page,
        viewport: viewport._raw,
        structTreeLayer: null,
        commentManager: null,
        linkService: linkService as any,
        annotationStorage: this._annotationStorage,
      } as any);

      if (cancelled) return;

      await annotLayer.render({
        viewport: viewport._raw,
        div: container,
        annotations: pdfAnnotations,
        page: this._page,
        linkService: linkService as any,
        renderForms: options?.renderForms ?? false,
        annotationStorage: this._annotationStorage,
      } as any);
    })();

    return {
      promise,
      cancel() {
        cancelled = true;
      },
    };
  }

  async getTextContent(): Promise<PdfTextItem[]> {
    const content = await this._page.getTextContent();
    return content.items.map((item: any) => ({ str: item.str ?? "" }));
  }
}

export const pdfjsEngine: PdfEngine = {
  async loadDocument(data: Uint8Array): Promise<PdfDocument> {
    const loadingTask = pdfjsLib.getDocument({ data });
    const doc = await loadingTask.promise;
    return new PdfJsDocument(doc);
  },

  isCancelError(err: unknown): boolean {
    return (
      err != null &&
      typeof err === "object" &&
      (err as any).name === "RenderingCancelledException"
    );
  },
};
