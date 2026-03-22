import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { RenderTask } from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
import type { PageDimension, Annotation, AnnotationTool } from "../types";
import type { SearchMatch } from "../hooks/useTextSearch";
import { AnnotationOverlay } from "./AnnotationOverlay";

interface PageCanvasProps {
  pdfDoc: PDFDocumentProxy;
  dimension: PageDimension;
  zoom: number;
  isVisible: boolean;
  annotations: Annotation[];
  activeTool: AnnotationTool;
  onAddAnnotation: (annotation: Annotation) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  onDeleteAnnotation: (id: string) => void;
  searchQuery: string;
  searchMatches: SearchMatch[];
  selectedMatchIndex: number;
}

export function PageCanvas({
  pdfDoc,
  dimension,
  zoom,
  isVisible,
  annotations,
  activeTool,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  searchQuery,
  searchMatches,
  selectedMatchIndex,
}: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textLayerRef = useRef<HTMLDivElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<RenderTask | null>(null);
  const textLayerInstanceRef = useRef<TextLayer | null>(null);
  const renderGenRef = useRef(0);
  // Bumped after text layer renders so the highlight effect re-runs
  const [textLayerReady, setTextLayerReady] = useState(0);

  const scaledWidth = dimension.width * zoom;
  const scaledHeight = dimension.height * zoom;

  // Render canvas + text layer
  useEffect(() => {
    if (!isVisible || !canvasRef.current || !textLayerRef.current) return;

    const generation = ++renderGenRef.current;
    let cancelled = false;

    async function render() {
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch {}
        renderTaskRef.current = null;
      }
      if (textLayerInstanceRef.current) {
        try { textLayerInstanceRef.current.cancel(); } catch {}
        textLayerInstanceRef.current = null;
      }

      try {
        const page = await pdfDoc.getPage(dimension.pageNumber);
        if (cancelled || generation !== renderGenRef.current) return;

        const viewport = page.getViewport({ scale: zoom });
        const canvas = canvasRef.current!;
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const task = page.render({ canvas, viewport });
        renderTaskRef.current = task;
        await task.promise;

        if (cancelled || generation !== renderGenRef.current) return;

        const textLayerDiv = textLayerRef.current!;
        textLayerDiv.innerHTML = "";

        const textContent = await page.getTextContent();
        if (cancelled || generation !== renderGenRef.current) return;

        const textLayer = new TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        });
        textLayerInstanceRef.current = textLayer;
        await textLayer.render();

        if (cancelled || generation !== renderGenRef.current) return;

        setTextLayerReady((v) => v + 1);
      } catch (err: any) {
        if (err?.name !== "RenderingCancelledException" && !cancelled) {
          console.error(`[PageCanvas] Render error page ${dimension.pageNumber}:`, err);
        }
      }
    }

    render();
    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try { renderTaskRef.current.cancel(); } catch {}
        renderTaskRef.current = null;
      }
      if (textLayerInstanceRef.current) {
        try { textLayerInstanceRef.current.cancel(); } catch {}
        textLayerInstanceRef.current = null;
      }
      // Clear text layer DOM
      if (textLayerRef.current) {
        textLayerRef.current.innerHTML = "";
      }
      // Release GPU memory
      if (canvasRef.current) {
        canvasRef.current.width = 0;
        canvasRef.current.height = 0;
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
          <div ref={highlightRef} className="search-highlights" />
          <AnnotationOverlay
            pageNumber={dimension.pageNumber}
            width={scaledWidth}
            height={scaledHeight}
            dimension={dimension}
            zoom={zoom}
            annotations={annotations}
            activeTool={activeTool}
            onAddAnnotation={onAddAnnotation}
            onUpdateAnnotation={onUpdateAnnotation}
            onDeleteAnnotation={onDeleteAnnotation}
          />
        </>
      )}
    </div>
  );
}
