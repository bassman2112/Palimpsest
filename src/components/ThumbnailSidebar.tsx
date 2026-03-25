import { useCallback, useEffect, useRef, useState } from "react";
import type { PdfDocument } from "../lib/pdf";
import type { Annotation, PageDimension } from "../types";
import { Thumbnail } from "./Thumbnail";
import { ThumbnailContextMenu } from "./ThumbnailContextMenu";

interface ThumbnailSidebarProps {
  pdfDoc: PdfDocument;
  pageDimensions: PageDimension[];
  currentPage: number;
  getPageAnnotations?: (pageNumber: number) => Annotation[];
  onPageClick: (pageNumber: number) => void;
  onDeletePage?: (pageNumber: number) => void;
  onReorderPage?: (from: number, to: number) => void;
  onRotatePage?: (pageNumbers: number[], degrees: number) => void;
}

interface DragState {
  pageNumber: number;
  ghostX: number;
  ghostY: number;
}

export function ThumbnailSidebar({
  pdfDoc,
  pageDimensions,
  currentPage,
  getPageAnnotations,
  onPageClick,
  onDeletePage,
  onReorderPage,
  onRotatePage,
}: ThumbnailSidebarProps) {
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ pageNumber: number; x: number; y: number } | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);

  // Refs for long-press detection, auto-scroll, and pointer capture
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; pageNumber: number } | null>(null);
  const autoScrollSpeedRef = useRef(0);
  const capturedPointerIdRef = useRef<number | null>(null);
  const dropTargetRef = useRef<number | null>(null);

  const autoScrollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const totalPages = pageDimensions.length;

  // Auto-scroll active thumbnail into view
  useEffect(() => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return;
    const active = sidebar.querySelector(".thumbnail-active");
    if (active) {
      active.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [currentPage]);

  // Clean up timers on unmount
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
    // Release pointer capture if held
    if (capturedPointerIdRef.current !== null && sidebarRef.current) {
      try { sidebarRef.current.releasePointerCapture(capturedPointerIdRef.current); } catch {}
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

  const computeDropTarget = useCallback((clientY: number, draggedPage: number): number | null => {
    const sidebar = sidebarRef.current;
    if (!sidebar) return null;

    const thumbnails = sidebar.querySelectorAll(".thumbnail");
    let target: number | null = null;

    for (let i = 0; i < thumbnails.length; i++) {
      const rect = thumbnails[i].getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const pageNum = i + 1;

      if (clientY < midY) {
        target = pageNum;
        break;
      }
    }

    // If we didn't break, cursor is below all thumbnails
    if (target === null) {
      target = totalPages + 1;
    }

    // Don't show indicator at current or adjacent position (no-op drop)
    if (target === draggedPage || target === draggedPage + 1) {
      return null;
    }

    return target;
  }, [totalPages]);

  const handlePointerDown = useCallback((pageNumber: number, e: React.PointerEvent) => {
    if (totalPages <= 1) return;

    const pointerId = e.pointerId;
    pointerStartRef.current = { x: e.clientX, y: e.clientY, pageNumber };

    longPressTimerRef.current = setTimeout(() => {
      // Initiate drag and capture pointer so events continue outside window
      setDragState({ pageNumber, ghostX: e.clientX, ghostY: e.clientY });
      longPressTimerRef.current = null;
      if (sidebarRef.current) {
        try {
          sidebarRef.current.setPointerCapture(pointerId);
          capturedPointerIdRef.current = pointerId;
        } catch {}
      }
    }, 400);
  }, [totalPages]);

  const updateAutoScroll = useCallback((clientY: number) => {
    const sidebar = sidebarRef.current;
    if (!sidebar) { stopAutoScroll(); return; }

    const rect = sidebar.getBoundingClientRect();
    const EDGE_ZONE = 40; // px from edge to trigger scroll
    const MAX_SPEED = 12; // px per frame

    const distFromTop = clientY - rect.top;
    const distFromBottom = rect.bottom - clientY;

    if (distFromTop < EDGE_ZONE && distFromTop >= 0) {
      autoScrollSpeedRef.current = -Math.round(MAX_SPEED * (1 - distFromTop / EDGE_ZONE));
      if (!autoScrollRef.current) {
        autoScrollRef.current = setInterval(() => {
          sidebar.scrollTop += autoScrollSpeedRef.current;
        }, 16);
      }
    } else if (distFromBottom < EDGE_ZONE && distFromBottom >= 0) {
      autoScrollSpeedRef.current = Math.round(MAX_SPEED * (1 - distFromBottom / EDGE_ZONE));
      if (!autoScrollRef.current) {
        autoScrollRef.current = setInterval(() => {
          sidebar.scrollTop += autoScrollSpeedRef.current;
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

  // Pre-drag: cancel long-press if pointer moves too far
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

  // Window-level drag tracking: pointer move, pointer up, escape — active only while dragging
  const dragStateRef = useRef(dragState);
  dragStateRef.current = dragState;

  useEffect(() => {
    if (!dragState) return;

    const handleMove = (e: PointerEvent) => {
      const ds = dragStateRef.current;
      if (!ds) return;
      setDragState((prev) => prev ? { ...prev, ghostX: e.clientX, ghostY: e.clientY } : null);
      const dt = computeDropTarget(e.clientY, ds.pageNumber);
      setDropTarget(dt);
      dropTargetRef.current = dt;
      updateAutoScroll(e.clientY);
    };

    const handleUp = () => {
      const ds = dragStateRef.current;
      const dt = dropTargetRef.current;
      if (ds && dt !== null) {
        const to = dt > ds.pageNumber ? dt - 1 : dt;
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
    // Immediately start drag mode for this page — the user moves the pointer to place it
    setDragState({ pageNumber: contextMenu.pageNumber, ghostX: contextMenu.x, ghostY: contextMenu.y });
  }, [contextMenu, totalPages]);

  // Get drop indicator position
  const getDropIndicatorStyle = useCallback((): React.CSSProperties | null => {
    if (!dragState || dropTarget === null || !sidebarRef.current) return null;

    const thumbnails = sidebarRef.current.querySelectorAll(".thumbnail");
    if (thumbnails.length === 0) return null;

    let top: number;
    const sidebarRect = sidebarRef.current.getBoundingClientRect();

    if (dropTarget <= totalPages) {
      const targetThumb = thumbnails[dropTarget - 1];
      if (!targetThumb) return null;
      const rect = targetThumb.getBoundingClientRect();
      top = rect.top - sidebarRect.top + sidebarRef.current.scrollTop - 5;
    } else {
      // After last thumbnail
      const lastThumb = thumbnails[thumbnails.length - 1];
      const rect = lastThumb.getBoundingClientRect();
      top = rect.bottom - sidebarRect.top + sidebarRef.current.scrollTop + 3;
    }

    return { top };
  }, [dragState, dropTarget, totalPages]);

  const indicatorStyle = getDropIndicatorStyle();

  return (
    <div
      className="thumbnail-sidebar"
      ref={sidebarRef}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePreDragMove}
      style={{ position: "relative", cursor: dragState ? "grabbing" : undefined }}
    >
      {pageDimensions.map((dim) => (
        <Thumbnail
          key={dim.pageNumber}
          pdfDoc={pdfDoc}
          dimension={dim}
          isActive={dim.pageNumber === currentPage}
          isDragging={dragState?.pageNumber === dim.pageNumber}
          annotations={getPageAnnotations?.(dim.pageNumber)}
          onClick={() => {
            if (!dragState) onPageClick(dim.pageNumber);
          }}
          onDeletePage={onDeletePage}
          onContextMenu={handleContextMenu}
          onPointerDown={handlePointerDown}
        />
      ))}

      {dragState && indicatorStyle && (
        <div className="thumbnail-drop-indicator" style={indicatorStyle} />
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
          onRotateClockwise={onRotatePage ? () => onRotatePage([contextMenu.pageNumber], 90) : undefined}
          onRotateCounterclockwise={onRotatePage ? () => onRotatePage([contextMenu.pageNumber], -90) : undefined}
          onDelete={() => onDeletePage?.(contextMenu.pageNumber)}
          onClose={closeMenu}
        />
      )}
    </div>
  );
}
