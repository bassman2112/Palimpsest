export type {
  PdfDocument,
  PdfPage,
  PdfViewport,
  PdfRenderTask,
  PdfLayerHandle,
  PdfTextItem,
  PdfEngine,
} from "./types";
export { pdfjsEngine } from "./pdfjs";
export { mupdfEngine } from "./mupdf";

import type { PdfEngine } from "./types";
import { pdfjsEngine } from "./pdfjs";
import { mupdfEngine } from "./mupdf";

/** Change to "mupdf" to use the MuPDF WASM renderer */
const DEFAULT_ENGINE = "mupdf" as "pdfjs" | "mupdf";

let activeEngine: PdfEngine =
  DEFAULT_ENGINE === "mupdf" ? mupdfEngine : pdfjsEngine;

export function getEngine(): PdfEngine {
  return activeEngine;
}

export function setEngine(engine: PdfEngine) {
  activeEngine = engine;
}
