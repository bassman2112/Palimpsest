import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PageDimension } from "../types";
import { Thumbnail } from "./Thumbnail";
import { ThumbnailContextMenu } from "./ThumbnailContextMenu";

interface PageGalleryProps {
  pdfDoc: PDFDocumentProxy;
  pageDimensions: PageDimension[];
  onPageClick: (pageNumber: number) => void;
  onDeletePage?: (pageNumber: number) => void;
  onReorderPage?: (from: number, to: number) => void;
}

interface DragState {
  pageNumber: number;
  ghostX: number;
  ghostY: number;
}

const GALLERY_THUMB_SIZE = 200;

export function PageGallery({
  pdfDoc,
  pageDimensions,
  onPageClick,
  onDeletePage,
  onReorderPage,
}: PageGalleryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ pageNumber: number; x: number; y: number } | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; side: "left" | "right" } | null>(null);

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; pageNumber: number } | null>(null);
  const capturedPointerIdRef = useRef<number | null>(null);
  const dropTargetRef = useRef<typeof dropTarget>(null);
  const autoScrollSpeedRef = useRef(0);
  const autoScrollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalPages = pageDimensions.length;

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (autoScrollRef.current) clearInterval(autoScrollRef.current);
    };
  }, []);

  const stopAutoScroll = useCallback(() => {
    if (autoScrollRef.current) {
      clearInterval(autoScrollRef.current);
      autoScrollRef.current = null;
    }
  }, []);

  const clearDrag = useCallback(() => {
    if (capturedPointerIdRef.current !== null && containerRef.current) {
      try { containerRef.current.releasePointerCapture(capturedPointerIdRef.current); } catch {}
      capturedPointerIdRef.current = null;
    }
    setDragState(null);
    setDropTarget(null);
    dropTargetRef.current = null;
    stopAutoScroll();
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerStartRef.current = null;
  }, [stopAutoScroll]);

  const computeDropTarget = useCallback((clientX: number, clientY: number, draggedPage: number): typeof dropTarget => {
    const container = containerRef.current;
    if (!container) return null;

    const thumbnails = container.querySelectorAll(".gallery-thumbnail");
    if (thumbnails.length === 0) return null;

    let closest: { index: number; side: "left" | "right"; dist: number } | null = null;

    for (let i = 0; i < thumbnails.length; i++) {
      const rect = thumbnails[i].getBoundingClientRect();
      const midX = rect.left + rect.width / 2;
      const midY = rect.top + rect.height / 2;
      const dist = Math.hypot(clientX - midX, clientY - midY);
      const side: "left" | "right" = clientX < midX ? "left" : "right";

      if (closest === null || dist < closest.dist) {
        closest = { index: i, side, dist };
      }
    }

    if (!closest) return null;

    // Convert to insertion page number
    const insertAt = closest.side === "left" ? closest.index + 1 : closest.index + 2;

    // No-op if dropping at current or adjacent position
    if (insertAt === draggedPage || insertAt === draggedPage + 1) {
      return null;
    }

    return { index: closest.index, side: closest.side };
  }, []);

  const handlePointerDown = useCallback((pageNumber: number, e: React.PointerEvent) => {
    if (totalPages <= 1) return;

    const pointerId = e.pointerId;
    pointerStartRef.current = { x: e.clientX, y: e.clientY, pageNumber };

    longPressTimerRef.current = setTimeout(() => {
      setDragState({ pageNumber, ghostX: e.clientX, ghostY: e.clientY });
      longPressTimerRef.current = null;
      if (containerRef.current) {
        try {
          containerRef.current.setPointerCapture(pointerId);
          capturedPointerIdRef.current = pointerId;
        } catch {}
      }
    }, 400);
  }, [totalPages]);

  const updateAutoScroll = useCallback((clientY: number) => {
    const container = containerRef.current;
    if (!container) { stopAutoScroll(); return; }

    const rect = container.getBoundingClientRect();
    const EDGE_ZONE = 40;
    const MAX_SPEED = 12;

    const distFromTop = clientY - rect.top;
    const distFromBottom = rect.bottom - clientY;

    if (distFromTop < EDGE_ZONE && distFromTop >= 0) {
      autoScrollSpeedRef.current = -Math.round(MAX_SPEED * (1 - distFromTop / EDGE_ZONE));
      if (!autoScrollRef.current) {
        autoScrollRef.current = setInterval(() => {
          container.scrollTop += autoScrollSpeedRef.current;
        }, 16);
      }
    } else if (distFromBottom < EDGE_ZONE && distFromBottom >= 0) {
      autoScrollSpeedRef.current = Math.round(MAX_SPEED * (1 - distFromBottom / EDGE_ZONE));
      if (!autoScrollRef.current) {
        autoScrollRef.current = setInterval(() => {
          container.scrollTop += autoScrollSpeedRef.current;
        }, 16);
      }
    } else {
      stopAutoScroll();
    }
  }, [stopAutoScroll]);

  const handlePointerUp = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    pointerStartRef.current = null;
  }, []);

  const handlePreDragMove = useCallback((e: React.PointerEvent) => {
    if (pointerStartRef.current && !dragState && longPressTimerRef.current) {
      const dx = e.clientX - pointerStartRef.current.x;
      const dy = e.clientY - pointerStartRef.current.y;
      if (Math.sqrt(dx * dx + dy * dy) > 15) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
        pointerStartRef.current = null;
      }
    }
  }, [dragState]);

  // Window-level drag tracking
  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;

  useEffect(() => {
    if (!dragState) return;

    const handleMove = (e: PointerEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;
      setDragState((prev) => prev ? { ...prev, ghostX: e.clientX, ghostY: e.clientY } : null);
      const dt = computeDropTarget(e.clientX, e.clientY, ds.pageNumber);
      setDropTarget(dt);
      dropTargetRef.current = dt;
      updateAutoScroll(e.clientY);
    };

    const handleUp = () => {
      const ds = dragStateRef.current;
      const dt = dropTargetRef.current;
      if (ds && dt !== null) {
        const insertAt = dt.side === "left" ? dt.index + 1 : dt.index + 2;
        const to = insertAt > ds.pageNumber ? insertAt - 1 : insertAt;
        if (to !== ds.pageNumber) {
          onReorderPage?.(ds.pageNumber, to);
        }
      }
      clearDrag();
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") clearDrag();
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [dragState, computeDropTarget, updateAutoScroll, onReorderPage, clearDrag]);

  const handleContextMenu = useCallback((pageNumber: number, x: number, y: number) => {
    setContextMenu({ pageNumber, x, y });
  }, []);

  const closeMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleReorderFromMenu = useCallback(() => {
    if (!contextMenu || totalPages <= 1) return;
    setDragState({ pageNumber: contextMenu.pageNumber, ghostX: contextMenu.x, ghostY: contextMenu.y });
  }, [contextMenu, totalPages]);

  // Get drop indicator position
  const getDropIndicatorStyle = useCallback((): React.CSSProperties | null => {
    if (!dragState || dropTarget === null || !containerRef.current) return null;

    const thumbnails = containerRef.current.querySelectorAll(".gallery-thumbnail");
    if (thumbnails.length === 0 || dropTarget.index >= thumbnails.length) return null;

    const thumb = thumbnails[dropTarget.index];
    const containerRect = containerRef.current.getBoundingClientRect();
    const rect = thumb.getBoundingClientRect();

    const top = rect.top - containerRect.top + containerRef.current.scrollTop;
    const height = rect.height;

    if (dropTarget.side === "left") {
      return { top, height, left: rect.left - containerRect.left - 4 };
    } else {
      return { top, height, left: rect.right - containerRect.left + 2 };
    }
  }, [dragState, dropTarget]);

  const indicatorStyle = getDropIndicatorStyle();

  return (
    <div
      className="page-gallery"
      ref={containerRef}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePreDragMove}
      style={{ cursor: dragState ? "grabbing" : undefined }}
    >
      <div className="page-gallery-grid">
        {pageDimensions.map((dim) => (
          <div key={dim.pageNumber} className="gallery-thumbnail">
            <Thumbnail
              pdfDoc={pdfDoc}
              dimension={dim}
              isActive={false}
              isDragging={dragState?.pageNumber === dim.pageNumber}
              size={GALLERY_THUMB_SIZE}
              onClick={() => {
                if (!dragState) onPageClick(dim.pageNumber);
              }}
              onDeletePage={onDeletePage}
              onContextMenu={handleContextMenu}
              onPointerDown={handlePointerDown}
            />
          </div>
        ))}
      </div>

      {dragState && indicatorStyle && (
        <div
          className="gallery-drop-indicator"
          style={{
            position: "absolute",
            top: indicatorStyle.top,
            left: indicatorStyle.left,
            height: indicatorStyle.height,
          }}
        />
      )}

      {dragState && (
        <div
          className="thumbnail-drag-ghost"
          style={{ left: dragState.ghostX + 12, top: dragState.ghostY - 14 }}
        >
          Page {dragState.pageNumber}
        </div>
      )}

      {contextMenu && (
        <ThumbnailContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          pageNumber={contextMenu.pageNumber}
          totalPages={totalPages}
          onMoveUp={() => onReorderPage?.(contextMenu.pageNumber, contextMenu.pageNumber - 1)}
          onMoveDown={() => onReorderPage?.(contextMenu.pageNumber, contextMenu.pageNumber + 1)}
          onReorder={handleReorderFromMenu}
          onDelete={() => onDeletePage?.(contextMenu.pageNumber)}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
