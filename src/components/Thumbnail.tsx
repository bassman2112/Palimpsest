import { useEffect, useRef } from "react";
import type { PdfDocument, PdfRenderTask } from "../lib/pdf";
import { getEngine } from "../lib/pdf";
import type { Annotation, PageDimension } from "../types";

const THUMB_WIDTH = 150;

interface ThumbnailProps {
  pdfDoc: PdfDocument;
  dimension: PageDimension;
  isActive: boolean;
  isDragging?: boolean;
  isSelected?: boolean;
  size?: number;
  label?: string;
  annotations?: Annotation[];
  onClick: (e: React.MouseEvent) => void;
  onDoubleClick?: () => void;
  onDeletePage?: (pageNumber: number) => void;
  onDeleteMergePage?: () => void;
  onContextMenu?: (pageNumber: number, x: number, y: number) => void;
  onPointerDown?: (pageNumber: number, e: React.PointerEvent) => void;
  isBookmarked?: boolean;
  onToggleBookmark?: (pageNumber: number) => void;
}

export function Thumbnail({ pdfDoc, dimension, isActive, isDragging, isSelected, size, label, annotations, onClick, onDoubleClick, onDeletePage, onDeleteMergePage, onContextMenu, onPointerDown, isBookmarked, onToggleBookmark }: ThumbnailProps) {
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
        {annotations && annotations.length > 0 && (
          <div
            className="thumbnail-annotations"
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: thumbWidth,
              height: thumbHeight,
              pointerEvents: "none",
              overflow: "hidden",
            }}
          >
            {annotations.map((ann) => {
              if (ann.type === "highlight") {
                return (
                  <div
                    key={ann.id}
                    style={{
                      position: "absolute",
                      left: ann.x * thumbWidth,
                      top: ann.y * thumbHeight,
                      width: ann.width * thumbWidth,
                      height: ann.height * thumbHeight,
                      backgroundColor: ann.color,
                      opacity: 0.35,
                    }}
                  />
                );
              }
              if (ann.type === "underline" || ann.type === "strikethrough") {
                const lineY = ann.type === "strikethrough" ? 0.5 : 1;
                return (
                  <div
                    key={ann.id}
                    style={{
                      position: "absolute",
                      left: ann.x * thumbWidth,
                      top: ann.y * thumbHeight,
                      width: ann.width * thumbWidth,
                      height: ann.height * thumbHeight,
                    }}
                  >
                    <div style={{
                      position: "absolute",
                      left: 0,
                      top: `${lineY * 100}%`,
                      width: "100%",
                      height: 1,
                      backgroundColor: ann.color,
                      opacity: 0.8,
                    }} />
                  </div>
                );
              }
              if (ann.type === "sticky-note") {
                return (
                  <div
                    key={ann.id}
                    style={{
                      position: "absolute",
                      left: ann.x * thumbWidth - 5,
                      top: ann.y * thumbHeight - 5,
                      width: 10,
                      height: 10,
                      backgroundColor: ann.color,
                      borderRadius: 2,
                      border: "1px solid rgba(0,0,0,0.3)",
                    }}
                  />
                );
              }
              if (ann.type === "signature") {
                return (
                  <img
                    key={ann.id}
                    src={ann.imageData}
                    style={{
                      position: "absolute",
                      left: ann.x * thumbWidth,
                      top: ann.y * thumbHeight,
                      width: ann.width * thumbWidth,
                      height: ann.height * thumbHeight,
                      opacity: 0.8,
                    }}
                  />
                );
              }
              if (ann.type === "ink") {
                const sw = Math.max(1, ann.strokeWidth * scale * 0.5);
                return (
                  <svg
                    key={ann.id}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: thumbWidth,
                      height: thumbHeight,
                    }}
                  >
                    {ann.paths.map((path, pi) => (
                      <polyline
                        key={pi}
                        points={path.map((pt) => `${pt.x * thumbWidth},${pt.y * thumbHeight}`).join(" ")}
                        fill="none"
                        stroke={ann.color}
                        strokeWidth={sw}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    ))}
                  </svg>
                );
              }
              if (ann.type === "shape") {
                const x1 = ann.x1 * thumbWidth;
                const y1 = ann.y1 * thumbHeight;
                const x2 = ann.x2 * thumbWidth;
                const y2 = ann.y2 * thumbHeight;
                const sw = Math.max(1, ann.strokeWidth * scale * 0.5);
                const minX = Math.min(x1, x2);
                const minY = Math.min(y1, y2);
                const w = Math.abs(x2 - x1);
                const h = Math.abs(y2 - y1);
                return (
                  <svg
                    key={ann.id}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: thumbWidth,
                      height: thumbHeight,
                    }}
                  >
                    {ann.shape === "rectangle" && (
                      <rect x={minX} y={minY} width={w} height={h} fill="none" stroke={ann.color} strokeWidth={sw} />
                    )}
                    {ann.shape === "ellipse" && (
                      <ellipse cx={minX + w / 2} cy={minY + h / 2} rx={w / 2} ry={h / 2} fill="none" stroke={ann.color} strokeWidth={sw} />
                    )}
                    {(ann.shape === "line" || ann.shape === "arrow") && (
                      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={ann.color} strokeWidth={sw} />
                    )}
                  </svg>
                );
              }
              if (ann.type === "text") {
                const fontSize = Math.max(4, ann.fontSize * scale);
                return (
                  <div
                    key={ann.id}
                    style={{
                      position: "absolute",
                      left: ann.x * thumbWidth,
                      top: ann.y * thumbHeight,
                      width: ann.width * thumbWidth,
                      height: ann.height * thumbHeight,
                      backgroundColor: ann.backgroundColor !== "transparent" ? ann.backgroundColor : undefined,
                      color: ann.color,
                      fontSize,
                      fontFamily: ann.fontFamily,
                      fontWeight: ann.bold ? "bold" : undefined,
                      fontStyle: ann.italic ? "italic" : undefined,
                      overflow: "hidden",
                      lineHeight: 1.2,
                    }}
                  />
                );
              }
              return null;
            })}
          </div>
        )}
        {onToggleBookmark && (
          <button
            className={`thumbnail-bookmark-btn${isBookmarked ? " thumbnail-bookmark-active" : ""}`}
            onClick={(e) => {
              e.stopPropagation();
              onToggleBookmark(dimension.pageNumber);
            }}
            title={isBookmarked ? "Remove bookmark" : "Add bookmark"}
          >
            <svg width="12" height="14" viewBox="0 0 12 14" fill={isBookmarked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 1.5A.5.5 0 0 1 1.5 1h9a.5.5 0 0 1 .5.5V13l-5-3-5 3V1.5Z" />
            </svg>
          </button>
        )}
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
