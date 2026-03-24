import { useEffect, useRef, useState } from "react";
import type { PdfDocument, PdfRenderTask, PdfLayerHandle } from "../lib/pdf";
import { getEngine } from "../lib/pdf";
import type { PageDimension, Annotation, AnnotationTool } from "../types";
import type { SearchMatch } from "../hooks/useTextSearch";
import { AnnotationOverlay } from "./AnnotationOverlay";

interface PageCanvasProps {
  pdfDoc: PdfDocument;
  dimension: PageDimension;
  zoom: number;
  isVisible: boolean;
  annotations: Annotation[];
  activeTool: AnnotationTool;
  highlightColor: string;
  onAddAnnotation: (annotation: Annotation) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  onDeleteAnnotation: (id: string) => void;
  searchQuery: string;
  searchMatches: SearchMatch[];
  selectedMatchIndex: number;
  pendingSignature?: string | null;
}

export function PageCanvas({
  pdfDoc,
  dimension,
  zoom,
  isVisible,
  annotations,
  activeTool,
  highlightColor,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  searchQuery,
  searchMatches,
  selectedMatchIndex,
  pendingSignature,
}: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const annotationLayerRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<PdfRenderTask | null>(null);
  const textLayerHandleRef = useRef<PdfLayerHandle | null>(null);
  const annotationLayerHandleRef = useRef<PdfLayerHandle | null>(null);
  const renderGenRef = useRef(0);
  const prevRenderKeyRef = useRef("");
  // Bumped after text layer renders so the highlight effect re-runs
  const [textLayerReady, setTextLayerReady] = useState(0);

  const scaledWidth = dimension.width * zoom;
  const scaledHeight = dimension.height * zoom;

  // Render canvas + text layer (debounced on zoom-only changes)
  useEffect(() => {
    if (!isVisible || !canvasRef.current || !textLayerRef.current) return;

    const generation = ++renderGenRef.current;
    let cancelled = false;

    // Debounce when only zoom changed — CSS scaling provides instant
    // visual feedback while we wait for the expensive pixel render.
    const renderKey = `${pdfDoc}:${dimension.pageNumber}:${isVisible}`;
    const zoomOnly = prevRenderKeyRef.current === renderKey && generation > 1;
    prevRenderKeyRef.current = renderKey;

    const delay = zoomOnly ? 150 : 0;
    const timerId = setTimeout(() => {
      if (!cancelled && generation === renderGenRef.current) {
        render();
      }
    }, delay);

    async function render() {
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch {}
        renderTaskRef.current = null;
      }
      if (textLayerHandleRef.current) {
        try { textLayerHandleRef.current.cancel(); } catch {}
        textLayerHandleRef.current = null;
      }

      try {
        const page = await pdfDoc.getPage(dimension.pageNumber);
        if (cancelled || generation !== renderGenRef.current) return;

        const viewport = page.getViewport(zoom);
        const dpr = window.devicePixelRatio || 1;

        const task = page.renderToCanvas(canvasRef.current!, viewport, { devicePixelRatio: dpr });
        renderTaskRef.current = task;
        await task.promise;

        if (cancelled || generation !== renderGenRef.current) return;

        const textLayerDiv = textLayerRef.current!;
        textLayerDiv.innerHTML = "";

        const textHandle = page.renderTextLayer(textLayerDiv, viewport);
        textLayerHandleRef.current = textHandle;
        await textHandle.promise;

        if (cancelled || generation !== renderGenRef.current) return;

        // Render AnnotationLayer (form fields, links, etc.)
        const annotationLayerDiv = annotationLayerRef.current;
        if (annotationLayerDiv) {
          annotationLayerDiv.innerHTML = "";

          const annotHandle = page.renderAnnotationLayer(annotationLayerDiv, viewport, { renderForms: true });
          annotationLayerHandleRef.current = annotHandle;
          await annotHandle.promise;
        }

        if (cancelled || generation !== renderGenRef.current) return;

        setTextLayerReady((v) => v + 1);
      } catch (err) {
        if (!getEngine().isCancelError(err) && !cancelled) {
          console.error(`[PageCanvas] Render error page ${dimension.pageNumber}:`, err);
        }
      }
    }

    return () => {
      cancelled = true;
      clearTimeout(timerId);
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch {}
        renderTaskRef.current = null;
      }
      if (textLayerHandleRef.current) {
        try { textLayerHandleRef.current.cancel(); } catch {}
        textLayerHandleRef.current = null;
      }
      if (annotationLayerHandleRef.current) {
        try { annotationLayerHandleRef.current.cancel(); } catch {}
        annotationLayerHandleRef.current = null;
      }
    };
  }, [pdfDoc, dimension.pageNumber, zoom, isVisible]);

  // Apply search highlights via Range.getClientRects() overlay.
  // Now that TextLayer CSS correctly applies font-size and scaleX from
  // PDF.js custom properties, Range rects are accurate.
  useEffect(() => {
    const textContainer = textLayerRef.current;
    const hlContainer = highlightRef.current;
    if (!textContainer || !hlContainer) return;

    hlContainer.innerHTML = "";
    if (!searchQuery) return;

    const rafId = requestAnimationFrame(() => {
      const needle = searchQuery.toLowerCase();
      const parentRect = hlContainer.parentElement!.getBoundingClientRect();

      const spans = Array.from(textContainer.querySelectorAll<HTMLElement>("span"));
      const textSpans = spans.filter(
        (s) => s.children.length === 0 && s.textContent && s.textContent.length > 0
      );

      let matchCounter = 0;

      for (const span of textSpans) {
        const text = span.textContent ?? "";
        const lowerText = text.toLowerCase();
        const textNode = span.firstChild;
        if (!textNode || textNode.nodeType !== Node.TEXT_NODE) continue;

        let pos = 0;
        while ((pos = lowerText.indexOf(needle, pos)) !== -1) {
          const range = document.createRange();
          range.setStart(textNode, pos);
          range.setEnd(textNode, pos + needle.length);

          for (const rect of range.getClientRects()) {
            const hlDiv = document.createElement("div");
            hlDiv.className =
              "search-hl" + (matchCounter === selectedMatchIndex ? " search-hl-selected" : "");
            hlDiv.style.position = "absolute";
            hlDiv.style.left = `${rect.left - parentRect.left}px`;
            hlDiv.style.top = `${rect.top - parentRect.top}px`;
            hlDiv.style.width = `${rect.width}px`;
            hlDiv.style.height = `${rect.height}px`;
            hlContainer.appendChild(hlDiv);
          }

          matchCounter++;
          pos += needle.length;
        }
      }
    });

    return () => cancelAnimationFrame(rafId);
  }, [searchQuery, searchMatches, selectedMatchIndex, textLayerReady]);

  return (
    <div
      className="page-container"
      data-page-number={dimension.pageNumber}
      style={{ width: scaledWidth, height: scaledHeight }}
    >
      <canvas
        ref={canvasRef}
        style={{
          width: isVisible ? scaledWidth : 0,
          height: isVisible ? scaledHeight : 0,
          display: isVisible ? undefined : "none",
        }}
      />
      {isVisible && (
        <>
          <div ref={textLayerRef} className="textLayer" />
          <div ref={annotationLayerRef} className="annotationLayer" />
          <div ref={highlightRef} className="search-highlights" />
          <AnnotationOverlay
            pageNumber={dimension.pageNumber}
            width={scaledWidth}
            height={scaledHeight}
            dimension={dimension}
            zoom={zoom}
            annotations={annotations}
            activeTool={activeTool}
            highlightColor={highlightColor}
            onAddAnnotation={onAddAnnotation}
            onUpdateAnnotation={onUpdateAnnotation}
            onDeleteAnnotation={onDeleteAnnotation}
            pendingSignature={pendingSignature}
          />
        </>
      )}
    </div>
  );
}
