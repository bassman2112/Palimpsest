import { useEffect, useRef } from "react";
import type { PdfDocument, PdfRenderTask } from "../lib/pdf";
import { getEngine } from "../lib/pdf";
import type { PageDimension } from "../types";

const THUMB_WIDTH = 150;

interface ThumbnailProps {
  pdfDoc: PdfDocument;
  dimension: PageDimension;
  isActive: boolean;
  isDragging?: boolean;
  isSelected?: boolean;
  size?: number;
  label?: string;
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  onDeletePage?: (pageNumber: number) => void;
  onDeleteMergePage?: () => void;
  onContextMenu?: (pageNumber: number, x: number, y: number) => void;
  onPointerDown?: (pageNumber: number, e: React.PointerEvent) => void;
}

export function Thumbnail({ pdfDoc, dimension, isActive, isDragging, isSelected, size, label, onClick, onDoubleClick, onDeletePage, onDeleteMergePage, onContextMenu, onPointerDown }: ThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const renderTaskRef = useRef<PdfRenderTask | null>(null);
  const renderedRef = useRef(false);

  const thumbWidth = size ?? THUMB_WIDTH;
  const scale = thumbWidth / dimension.width;
  const thumbHeight = dimension.height * scale;

  // Reset rendered state when pdfDoc changes (e.g. after page reorder/delete)
  useEffect(() => {
    renderedRef.current = false;
  }, [pdfDoc]);

  useEffect(() => {
    if (renderedRef.current || !canvasRef.current || !containerRef.current) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !renderedRef.current) {
          renderedRef.current = true;
          renderThumb();
          observer.disconnect();
        }
      },
      { threshold: 0 }
    );

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [pdfDoc, dimension.pageNumber]);

  async function renderThumb() {
    if (renderTaskRef.current) {
      try { renderTaskRef.current.cancel(); } catch {}
    }

    try {
      const page = await pdfDoc.getPage(dimension.pageNumber);
      const viewport = page.getViewport(scale);
      const task = page.renderToCanvas(canvasRef.current!, viewport);
      renderTaskRef.current = task;
      await task.promise;
    } catch (err) {
      if (!getEngine().isCancelError(err)) {
        console.error(`[Thumbnail] Render error page ${dimension.pageNumber}:`, err);
      }
    }
  }

  return (
    <div
      ref={containerRef}
      className={`thumbnail ${isActive ? "thumbnail-active" : ""}${isDragging ? " thumbnail-dragging" : ""}${isSelected ? " thumbnail-selected" : ""}`}
      onClick={(e) => onClick(e)}
      onDoubleClick={onDoubleClick}
      onPointerDown={(e) => {
        if (e.button === 0) onPointerDown?.(dimension.pageNumber, e);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu?.(dimension.pageNumber, e.clientX, e.clientY);
      }}
    >
      <div style={{ position: "relative" }}>
        <canvas
          ref={canvasRef}
          style={{ width: thumbWidth, height: thumbHeight }}
        />
        {isSelected && <div className="thumbnail-select-check">&#10003;</div>}
        {onDeleteMergePage && (
          <button
            className="thumbnail-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              onDeleteMergePage();
            }}
            title="Remove page"
          >
            ✕
          </button>
        )}
        {!onDeleteMergePage && onDeletePage && (
          <button
            className="thumbnail-delete-btn"
            onClick={(e) => {
              e.stopPropagation();
              onDeletePage(dimension.pageNumber);
            }}
            title={`Delete page ${dimension.pageNumber}`}
          >
            ✕
          </button>
        )}
      </div>
      <span className="thumbnail-label">{label ?? dimension.pageNumber}</span>
    </div>
  );
}
