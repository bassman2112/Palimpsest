export interface PdfDocument {
  readonly numPages: number;
  getPage(pageNumber: number): Promise<PdfPage>;
  getFormData(): Record<string, { value: string; type?: string }> | null;
  onFormModified(callback: () => void): () => void;
  readonly annotationStorage: unknown;
  destroy(): Promise<void>;
}

export interface PdfPage {
  readonly pageNumber: number;
  getViewport(scale: number): PdfViewport;
  renderToCanvas(
    canvas: HTMLCanvasElement,
    viewport: PdfViewport,
    options?: { devicePixelRatio?: number },
  ): PdfRenderTask;
  renderTextLayer(container: HTMLElement, viewport: PdfViewport): PdfLayerHandle;
  renderAnnotationLayer(
    container: HTMLElement,
    viewport: PdfViewport,
    options?: { renderForms?: boolean },
  ): PdfLayerHandle;
  getTextContent(): Promise<PdfTextItem[]>;
}

export interface PdfViewport {
  readonly width: number;
  readonly height: number;
  /** @internal Opaque raw viewport for renderer internals. */
  readonly _raw: unknown;
}

export interface PdfRenderTask {
  readonly promise: Promise<void>;
  cancel(): void;
}

export interface PdfLayerHandle {
  readonly promise: Promise<void>;
  cancel(): void;
}

export interface PdfTextItem {
  readonly str: string;
}

export interface PdfEngine {
  loadDocument(data: Uint8Array): Promise<PdfDocument>;
  isCancelError(err: unknown): boolean;
}
