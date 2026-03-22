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

pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

export { pdfjsLib };
