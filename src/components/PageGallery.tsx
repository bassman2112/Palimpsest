import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { PageDimension, MergePage } from "../types";
import { Thumbnail } from "./Thumbnail";
import { ThumbnailContextMenu } from "./ThumbnailContextMenu";

interface PageGalleryProps {
  pdfDoc: PDFDocumentProxy;
  pageDimensions: PageDimension[];
  onPageClick: (pageNumber: number) => void;
  onDeletePage?: (pageNumber: number) => void;
  onDeletePages?: (pageNumbers: number[]) => void;
  onReorderPage?: (from: number, to: number) => void;
  onReorderPages?: (pages: number[], insertBefore: number) => void;
  pendingSelectionRef?: React.RefObject<number[] | null>;
  // Merge mode props
  mergePages?: MergePage[];
  isMerging?: boolean;
  onMergeRemovePage?: (pageId: string) => void;
  onMergeRemovePages?: (pageIds: string[]) => void;
  onMergeReorderPage?: (fromIndex: number, toIndex: number) => void;
  onMergeReorderPages?: (pageIds: string[], insertBefore: number) => void;
  onAddDocument?: () => void;
}

interface DragState {
  pageNumber: number;
  mergeIndex?: number;
  multiDragIds?: string[]; // set when dragging multiple selected pages (merge)
  multiDragPages?: number[]; // set when dragging multiple selected pages (normal)
  ghostX: number;
  ghostY: number;
}

const GALLERY_THUMB_SIZE = 200;

function truncateFileName(name: string, max: number = 20): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 3) + "...";
}

export function PageGallery({
  pdfDoc,
  pageDimensions,
  onPageClick,
  onDeletePage,
  onDeletePages,
  onReorderPage,
  onReorderPages,
  pendingSelectionRef,
  mergePages,
  isMerging,
  onMergeRemovePage,
  onMergeRemovePages,
  onMergeReorderPage,
  onMergeReorderPages,
  onAddDocument,
}: PageGalleryProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{ pageNumber: number; x: number; y: number } | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dropTarget, setDropTarget] = useState<{ index: number; side: "left" | "right" } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Normal mode selection by page number
  const [selectedPages, setSelectedPages] = useState<Set<number>>(new Set());
  const lastClickedIndexRef = useRef<number | null>(null);
  const lastClickedPageRef = useRef<number | null>(null);

  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number; pageNumber: number; mergeIndex?: number } | null>(null);
  const capturedPointerIdRef = useRef<number | null>(null);
  const dropTargetRef = useRef<typeof dropTarget>(null);
  const autoScrollSpeedRef = useRef(0);
  const autoScrollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const dragSelectionRef = useRef<Set<number> | null>(null);

  const inMerge = isMerging && mergePages;
  const totalPages = inMerge ? mergePages.length : pageDimensions.length;

  // Clear selection when leaving merge mode
  useEffect(() => {
    if (!inMerge) {
      setSelectedIds(new Set());
      lastClickedIndexRef.current = null;
    }
  }, [inMerge]);

  // On document reload: restore pending selection from drag or undo, or clear
  useEffect(() => {
    if (dragSelectionRef.current) {
      // From multi-drag within gallery
      setSelectedPages(dragSelectionRef.current);
      dragSelectionRef.current = null;
    } else if (pendingSelectionRef?.current) {
      // From undo in DocumentView
      setSelectedPages(new Set(pendingSelectionRef.current));
      pendingSelectionRef.current = null;
    } else {
      setSelectedPages(new Set());
    }
    lastClickedPageRef.current = null;
  }, [inMerge, pdfDoc]);

  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (autoScrollRef.current) clearInterval(autoScrollRef.current);
    };
  }, []);

  // Keyboard shortcuts for selection
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (inMerge) {
        // Merge mode shortcuts
        if ((e.metaKey || e.ctrlKey) && e.key === "a") {
          e.preventDefault();
          setSelectedIds(new Set(mergePages!.map((mp) => mp.id)));
        }
        if ((e.key === "Delete" || e.key === "Backspace") && selectedIds.size > 0) {
          e.preventDefault();
          onMergeRemovePages?.([...selectedIds]);
          setSelectedIds(new Set());
          lastClickedIndexRef.current = null;
        }
        if (e.key === "Escape" && selectedIds.size > 0) {
          setSelectedIds(new Set());
          lastClickedIndexRef.current = null;
        }
      } else {
        // Normal mode shortcuts
        if ((e.metaKey || e.ctrlKey) && e.key === "a") {
          e.preventDefault();
          setSelectedPages(new Set(pageDimensions.map((d) => d.pageNumber)));
        }
        if ((e.key === "Delete" || e.key === "Backspace") && selectedPages.size > 0) {
          const tag = (e.target as HTMLElement).tagName;
          if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
          e.preventDefault();
          if (onDeletePages) {
            onDeletePages([...selectedPages]);
          } else if (onDeletePage) {
            // Fallback: delete one by one (sorted descending to preserve indices)
            const sorted = [...selectedPages].sort((a, b) => b - a);
            for (const p of sorted) onDeletePage(p);
          }
          setSelectedPages(new Set());
          lastClickedPageRef.current = null;
        }
        if (e.key === "Escape" && selectedPages.size > 0) {
          setSelectedPages(new Set());
          lastClickedPageRef.current = null;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [inMerge, mergePages, selectedIds, onMergeRemovePages, selectedPages, onDeletePage, onDeletePages, pageDimensions]);

  const handleMergeClick = useCallback((idx: number, e: React.MouseEvent) => {
    if (dragState || !mergePages) return;

    const id = mergePages[idx].id;

    if (e.shiftKey && lastClickedIndexRef.current !== null) {
      // Range select
      const start = Math.min(lastClickedIndexRef.current, idx);
      const end = Math.max(lastClickedIndexRef.current, idx);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) {
          next.add(mergePages[i].id);
        }
        return next;
      });
    } else {
      // Plain click: toggle selection
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) {
          next.delete(id);
        } else {
          next.add(id);
        }
        return next;
      });
      lastClickedIndexRef.current = idx;
    }
  }, [dragState, mergePages, selectedIds]);

  const handleNormalClick = useCallback((pageNumber: number, e: React.MouseEvent) => {
    if (dragState) return;

    if (e.shiftKey && lastClickedPageRef.current !== null) {
      const start = Math.min(lastClickedPageRef.current, pageNumber);
      const end = Math.max(lastClickedPageRef.current, pageNumber);
      setSelectedPages((prev) => {
        const next = new Set(prev);
        for (let i = start; i <= end; i++) next.add(i);
        return next;
      });
    } else {
      setSelectedPages((prev) => {
        const next = new Set(prev);
        if (next.has(pageNumber)) {
          next.delete(pageNumber);
        } else {
          next.add(pageNumber);
        }
        return next;
      });
      lastClickedPageRef.current = pageNumber;
    }
  }, [dragState]);

  const handleNormalDoubleClick = useCallback((pageNumber: number) => {
    if (dragState) return;
    setSelectedPages(new Set());
    lastClickedPageRef.current = null;
    onPageClick(pageNumber);
  }, [dragState, onPageClick]);

  const handleDeleteSelected = useCallback(() => {
    if (inMerge) {
      if (selectedIds.size === 0) return;
      onMergeRemovePages?.([...selectedIds]);
      setSelectedIds(new Set());
      lastClickedIndexRef.current = null;
    } else {
      if (selectedPages.size === 0) return;
      if (onDeletePages) {
        onDeletePages([...selectedPages]);
      } else if (onDeletePage) {
        const sorted = [...selectedPages].sort((a, b) => b - a);
        for (const p of sorted) onDeletePage(p);
      }
      setSelectedPages(new Set());
      lastClickedPageRef.current = null;
    }
  }, [inMerge, selectedIds, onMergeRemovePages, selectedPages, onDeletePage, onDeletePages]);

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

  const computeDropTarget = useCallback((clientX: number, clientY: number, draggedPage: number, draggedMergeIndex?: number, isMultiDrag?: boolean): typeof dropTarget => {
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

    if (isMultiDrag) {
      // Skip no-op check for multi-drag; the hook handles it
    } else if (inMerge && draggedMergeIndex !== undefined) {
      const insertAt = closest.side === "left" ? closest.index : closest.index + 1;
      if (insertAt === draggedMergeIndex || insertAt === draggedMergeIndex + 1) {
        return null;
      }
    } else {
      const insertAt = closest.side === "left" ? closest.index + 1 : closest.index + 2;
      if (insertAt === draggedPage || insertAt === draggedPage + 1) {
        return null;
      }
    }

    return { index: closest.index, side: closest.side };
  }, [inMerge]);

  const handlePointerDown = useCallback((pageNumber: number, e: React.PointerEvent, mergeIndex?: number) => {
    if (totalPages <= 1) return;

    const pointerId = e.pointerId;
    pointerStartRef.current = { x: e.clientX, y: e.clientY, pageNumber, mergeIndex };

    longPressTimerRef.current = setTimeout(() => {
      // If dragging a selected page, carry all selected pages
      let multiDragIds: string[] | undefined;
      let multiDragPages: number[] | undefined;

      if (inMerge && mergeIndex !== undefined && mergePages) {
        const draggedId = mergePages[mergeIndex].id;
        if (selectedIds.has(draggedId) && selectedIds.size > 1) {
          multiDragIds = [...selectedIds];
        }
      } else if (!inMerge && selectedPages.has(pageNumber) && selectedPages.size > 1) {
        multiDragPages = [...selectedPages];
      }

      setDragState({ pageNumber, mergeIndex, multiDragIds, multiDragPages, ghostX: e.clientX, ghostY: e.clientY });
      longPressTimerRef.current = null;
      if (containerRef.current) {
        try {
          containerRef.current.setPointerCapture(pointerId);
          capturedPointerIdRef.current = pointerId;
        } catch {}
      }
    }, 400);
  }, [totalPages, inMerge, mergePages, selectedIds, selectedPages]);

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
      const isMulti = !!(ds.multiDragIds || ds.multiDragPages);
      const dt = computeDropTarget(e.clientX, e.clientY, ds.pageNumber, ds.mergeIndex, isMulti);
      setDropTarget(dt);
      dropTargetRef.current = dt;
      updateAutoScroll(e.clientY);
    };

    const handleUp = () => {
      const ds = dragStateRef.current;
      const dt = dropTargetRef.current;
      if (ds && dt !== null) {
        const insertAt = dt.side === "left" ? dt.index : dt.index + 1;
        if (inMerge && ds.multiDragIds && ds.multiDragIds.length > 1) {
          // Multi-drag: move all selected pages
          onMergeReorderPages?.(ds.multiDragIds, insertAt);
          setSelectedIds(new Set());
          lastClickedIndexRef.current = null;
        } else if (inMerge && ds.mergeIndex !== undefined) {
          const to = insertAt > ds.mergeIndex ? insertAt - 1 : insertAt;
          if (to !== ds.mergeIndex) {
            onMergeReorderPage?.(ds.mergeIndex, to);
          }
        } else if (!inMerge && ds.multiDragPages && ds.multiDragPages.length > 1) {
          // Multi-drag in normal mode: move all selected pages
          const insertAt = dt.side === "left" ? dt.index + 1 : dt.index + 2;
          onReorderPages?.(ds.multiDragPages, insertAt);
          // Compute new page numbers so we can keep them selected after reload
          const movedSet = new Set(ds.multiDragPages);
          const adjustedInsert = Array.from({ length: insertAt - 1 }, (_, i) => i + 1)
            .filter((p) => !movedSet.has(p)).length;
          dragSelectionRef.current = new Set(
            ds.multiDragPages.map((_, i) => adjustedInsert + i + 1)
          );
        } else {
          const pageInsert = dt.side === "left" ? dt.index + 1 : dt.index + 2;
          const to = pageInsert > ds.pageNumber ? pageInsert - 1 : pageInsert;
          if (to !== ds.pageNumber) {
            onReorderPage?.(ds.pageNumber, to);
          }
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
  }, [dragState, computeDropTarget, updateAutoScroll, onReorderPage, onReorderPages, onMergeReorderPage, onMergeReorderPages, clearDrag, inMerge]);

  const handleContextMenu = useCallback((pageNumber: number, x: number, y: number) => {
    if (!inMerge) {
      setContextMenu({ pageNumber, x, y });
    }
  }, [inMerge]);

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

  const getDragLabel = () => {
    if (!dragState) return "";
    if (dragState.multiDragIds && dragState.multiDragIds.length > 1) {
      return `${dragState.multiDragIds.length} pages`;
    }
    if (dragState.multiDragPages && dragState.multiDragPages.length > 1) {
      return `${dragState.multiDragPages.length} pages`;
    }
    if (inMerge && dragState.mergeIndex !== undefined) {
      const mp = mergePages![dragState.mergeIndex];
      return `${truncateFileName(mp.sourceFileName)} p${mp.sourcePageNumber}`;
    }
    return `Page ${dragState.pageNumber}`;
  };

  const hasSelection = inMerge ? selectedIds.size > 0 : selectedPages.size > 0;
  const selectionCount = inMerge ? selectedIds.size : selectedPages.size;

  return (
    <div
      className="page-gallery"
      ref={containerRef}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePreDragMove}
      style={{ cursor: dragState ? "grabbing" : undefined }}
    >
      <div className="page-gallery-grid">
        {inMerge
          ? mergePages!.map((mp, idx) => (
              <div key={mp.id} className="gallery-thumbnail">
                <Thumbnail
                  pdfDoc={mp.pdfDoc}
                  dimension={mp.dimension}
                  isActive={false}
                  isDragging={dragState?.mergeIndex === idx || (!!dragState?.multiDragIds && dragState.multiDragIds.includes(mp.id))}
                  isSelected={selectedIds.has(mp.id)}
                  size={GALLERY_THUMB_SIZE}
                  label={`${truncateFileName(mp.sourceFileName, 16)} p${mp.sourcePageNumber}`}
                  onClick={(e) => handleMergeClick(idx, e)}
                  onDeleteMergePage={() => onMergeRemovePage?.(mp.id)}
                  onPointerDown={(_, e) => handlePointerDown(mp.sourcePageNumber, e, idx)}
                />
              </div>
            ))
          : pageDimensions.map((dim) => (
              <div key={dim.pageNumber} className="gallery-thumbnail">
                <Thumbnail
                  pdfDoc={pdfDoc}
                  dimension={dim}
                  isActive={false}
                  isDragging={dragState?.pageNumber === dim.pageNumber || (!!dragState?.multiDragPages && dragState.multiDragPages.includes(dim.pageNumber))}
                  isSelected={selectedPages.has(dim.pageNumber)}
                  size={GALLERY_THUMB_SIZE}
                  onClick={(e) => handleNormalClick(dim.pageNumber, e)}
                  onDoubleClick={() => handleNormalDoubleClick(dim.pageNumber)}
                  onDeletePage={onDeletePage}
                  onContextMenu={handleContextMenu}
                  onPointerDown={handlePointerDown}
                />
              </div>
            ))}

        {onAddDocument && (
          <div className="gallery-add-tile" onClick={onAddDocument}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="16" y1="8" x2="16" y2="24" />
              <line x1="8" y1="16" x2="24" y2="16" />
            </svg>
            <span>Add PDF</span>
          </div>
        )}
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
          {getDragLabel()}
        </div>
      )}

      {!inMerge && contextMenu && (
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

      {hasSelection && (
        <div className="gallery-selection-bar">
          <span>{selectionCount} page{selectionCount !== 1 ? "s" : ""} selected</span>
          <button onClick={handleDeleteSelected} className="gallery-selection-delete">
            Delete Selected
          </button>
          <button
            onClick={() => {
              if (inMerge) {
                setSelectedIds(new Set());
                lastClickedIndexRef.current = null;
              } else {
                setSelectedPages(new Set());
                lastClickedPageRef.current = null;
              }
            }}
            className="gallery-selection-clear"
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}
