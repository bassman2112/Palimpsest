import { Document, ColorSpace, Matrix } from "mupdf";
import type { Page } from "mupdf";
import type {
  PdfDocument,
  PdfPage,
  PdfViewport,
  PdfRenderTask,
  PdfLayerHandle,
  PdfTextItem,
  PdfEngine,
  OutlineItem,
} from "./types";

interface MupdfViewportData {
  scale: number;
  bounds: [number, number, number, number];
}

const PAGE_CACHE_MAX = 50;

class MupdfDocument implements PdfDocument {
  private _pageCache = new Map<number, Page>();

  constructor(private readonly _doc: Document) {}

  get numPages(): number {
    return this._doc.countPages();
  }

  get annotationStorage(): unknown {
    return null;
  }

  async getPage(pageNumber: number): Promise<PdfPage> {
    let page = this._pageCache.get(pageNumber);
    if (page) {
      // Move to end for LRU ordering (Map preserves insertion order)
      this._pageCache.delete(pageNumber);
      this._pageCache.set(pageNumber, page);
    } else {
      // MuPDF is 0-indexed, our interface is 1-indexed
      page = this._doc.loadPage(pageNumber - 1);
      this._pageCache.set(pageNumber, page);
      // Evict oldest entry if cache exceeds limit
      if (this._pageCache.size > PAGE_CACHE_MAX) {
        const oldest = this._pageCache.keys().next().value!;
        this._pageCache.get(oldest)!.destroy();
        this._pageCache.delete(oldest);
      }
    }
    return new MupdfPage(page, pageNumber);
  }

  async getOutline(): Promise<OutlineItem[] | null> {
    try {
      const outline = this._doc.loadOutline();
      if (!outline || outline.length === 0) return null;

      interface MupdfOutlineItem {
        title?: string;
        page?: number;
        down?: MupdfOutlineItem[];
      }

      const convert = (items: MupdfOutlineItem[]): OutlineItem[] =>
        items.map((item) => ({
          title: item.title ?? "",
          pageNumber: typeof item.page === "number" ? item.page + 1 : null,
          children: item.down ? convert(item.down) : [],
        }));

      return convert(outline);
    } catch {
      return null;
    }
  }

  getFormData(): Record<string, { value: string; type?: string }> | null {
    return null;
  }

  onFormModified(_callback: () => void): () => void {
    return () => {};
  }

  async destroy(): Promise<void> {
    for (const page of this._pageCache.values()) {
      page.destroy();
    }
    this._pageCache.clear();
    this._doc.destroy();
  }
}

class MupdfPage implements PdfPage {
  constructor(
    private readonly _page: Page,
    readonly pageNumber: number,
  ) {}

  getViewport(scale: number): PdfViewport {
    const bounds = this._page.getBounds();
    const w = (bounds[2] - bounds[0]) * scale;
    const h = (bounds[3] - bounds[1]) * scale;
    return {
      width: w,
      height: h,
      _raw: { scale, bounds } as MupdfViewportData,
    };
  }

  renderToCanvas(
    canvas: HTMLCanvasElement,
    viewport: PdfViewport,
    options?: { devicePixelRatio?: number },
  ): PdfRenderTask {
    const dpr = options?.devicePixelRatio ?? 1;
    const { scale, bounds } = viewport._raw as MupdfViewportData;
    const [ox, oy] = bounds;
    const s = dpr * scale;

    // Build transform: translate origin to (0,0), then scale
    const matrix =
      ox === 0 && oy === 0
        ? Matrix.scale(s, s)
        : Matrix.concat(Matrix.translate(-ox, -oy), Matrix.scale(s, s));

    // alpha=false: composites against white (fixes transparent/dark backgrounds)
    // showExtras=false: don't render PDF annotations on canvas (our overlay handles them)
    const pixmap = this._page.toPixmap(matrix, ColorSpace.DeviceRGB, false, false);
    const w = pixmap.getWidth();
    const h = pixmap.getHeight();
    // getPixels() returns RGB (3 bytes/pixel) — convert to RGBA for ImageData
    const rgb = new Uint8Array(pixmap.getPixels());
    pixmap.destroy();

    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
      rgba[j] = rgb[i];
      rgba[j + 1] = rgb[i + 1];
      rgba[j + 2] = rgb[i + 2];
      rgba[j + 3] = 255;
    }

    // MuPDF may ceil pixmap dimensions, producing an extra white row/column.
    // Render to a temp canvas, then draw cropped to the expected viewport size.
    const expectedW = Math.round(viewport.width * dpr);
    const expectedH = Math.round(viewport.height * dpr);
    if (w > expectedW || h > expectedH) {
      const tmp = new OffscreenCanvas(w, h);
      const tmpCtx = tmp.getContext("2d")!;
      tmpCtx.putImageData(new ImageData(rgba, w, h), 0, 0);
      canvas.width = expectedW;
      canvas.height = expectedH;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(tmp, 0, 0, expectedW, expectedH, 0, 0, expectedW, expectedH);
    } else {
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d")!;
      ctx.putImageData(new ImageData(rgba, w, h), 0, 0);
    }

    return {
      promise: Promise.resolve(),
      cancel() {},
    };
  }

  renderTextLayer(container: HTMLElement, viewport: PdfViewport): PdfLayerHandle {
    const { scale, bounds } = viewport._raw as MupdfViewportData;
    const [ox, oy] = bounds;
    const sText = this._page.toStructuredText("preserve-whitespace");

    interface LineData {
      bbox: [number, number, number, number];
      chars: Array<{ c: string; size: number }>;
    }

    const lines: LineData[] = [];
    let currentLine: LineData | null = null;

    sText.walk({
      beginLine(bbox, _wmode, _direction) {
        currentLine = { bbox: bbox as [number, number, number, number], chars: [] };
      },
      onChar(c, _origin, _font, size, _quad, _color) {
        currentLine?.chars.push({ c, size });
      },
      endLine() {
        if (currentLine && currentLine.chars.length > 0) {
          lines.push(currentLine);
        }
        currentLine = null;
      },
    });

    sText.destroy();

    // Create positioned text spans for each line (enables text selection & search)
    for (const line of lines) {
      const [lx0, ly0, lx1] = line.bbox;
      const text = line.chars.map((ch) => ch.c).join("");
      if (!text.trim()) continue;

      const fontSize = line.chars[0]?.size ?? 12;

      const span = document.createElement("span");
      span.textContent = text;
      span.style.position = "absolute";
      span.style.left = `${(lx0 - ox) * scale}px`;
      span.style.top = `${(ly0 - oy) * scale}px`;
      span.style.fontSize = `${fontSize * scale}px`;
      span.style.fontFamily = "sans-serif";
      span.style.lineHeight = "1";
      span.style.whiteSpace = "pre";
      span.style.color = "transparent";

      container.appendChild(span);

      // Scale text horizontally to match expected width
      // Measure width before adding newline so scaleX is accurate
      const expectedWidth = (lx1 - lx0) * scale;
      const actualWidth = span.getBoundingClientRect().width;
      if (actualWidth > 0 && expectedWidth > 0) {
        span.style.transform = `scaleX(${expectedWidth / actualWidth})`;
        span.style.transformOrigin = "left top";
      }

      // Append newline so copy-paste preserves line breaks
      span.textContent = text + "\n";
    }

    return {
      promise: Promise.resolve(),
      cancel() {},
    };
  }

  renderAnnotationLayer(
    container: HTMLElement,
    viewport: PdfViewport,
    _options?: { renderForms?: boolean },
  ): PdfLayerHandle {
    const { scale, bounds } = viewport._raw as MupdfViewportData;
    const [ox, oy] = bounds;
    const links = this._page.getLinks();

    for (const link of links) {
      const [lx0, ly0, lx1, ly1] = link.getBounds();
      const uri = link.getURI();
      if (!uri) continue;

      const a = document.createElement("a");
      a.href = uri;
      a.target = "_blank";
      a.rel = "noopener noreferrer nofollow";
      a.style.position = "absolute";
      a.style.left = `${(lx0 - ox) * scale}px`;
      a.style.top = `${(ly0 - oy) * scale}px`;
      a.style.width = `${(lx1 - lx0) * scale}px`;
      a.style.height = `${(ly1 - ly0) * scale}px`;
      a.style.pointerEvents = "auto";

      container.appendChild(a);
    }

    return {
      promise: Promise.resolve(),
      cancel() {},
    };
  }

  async getTextContent(): Promise<PdfTextItem[]> {
    const sText = this._page.toStructuredText("preserve-whitespace");
    const text = sText.asText();
    sText.destroy();
    return text.split("\n").map((line) => ({ str: line }));
  }
}

export const mupdfEngine: PdfEngine = {
  async loadDocument(data: Uint8Array): Promise<PdfDocument> {
    const doc = Document.openDocument(data, "application/pdf");
    return new MupdfDocument(doc);
  },

  isCancelError(_err: unknown): boolean {
    return false;
  },
};
