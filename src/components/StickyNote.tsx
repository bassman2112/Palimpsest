import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { StickyNoteAnnotation, PageDimension } from "../types";

interface StickyNoteProps {
  annotation: StickyNoteAnnotation;
  dimension: PageDimension;
  zoom: number;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<StickyNoteAnnotation>) => void;
  onDelete: () => void;
  onContextMenu: (x: number, y: number) => void;
}

export function StickyNote({
  annotation,
  dimension,
  zoom,
  selected,
  onSelect,
  onUpdate,
  onDelete,
  onContextMenu,
}: StickyNoteProps) {
  // Auto-open for newly created (empty text) notes
  const [open, setOpen] = useState(() => annotation.text === "");
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const popoverRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const didDragRef = useRef(false);

  const left = annotation.x * dimension.width * zoom;
  const top = annotation.y * dimension.height * zoom;

  const openPopover = useCallback(() => {
    if (iconRef.current) {
      const rect = iconRef.current.getBoundingClientRect();
      setPopoverPos({ top: rect.bottom + 4, left: rect.left });
    }
    setOpen(true);
  }, []);

  // Reposition popover when scrolling while open
  useEffect(() => {
    if (!open || !iconRef.current) return;
    const rect = iconRef.current.getBoundingClientRect();
    setPopoverPos({ top: rect.bottom + 4, left: rect.left });
  }, [open, zoom]);

  // Focus textarea when popover opens
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  // Close popover on outside click or Escape
  useEffect(() => {
    if (!open) return;

    function handleOutsideClick(e: MouseEvent) {
      const target = e.target as Node;
      if (popoverRef.current?.contains(target)) return;
      if (iconRef.current?.contains(target)) return;
      // Stop propagation so the overlay doesn't create a new annotation
      e.stopPropagation();
      setOpen(false);
    }

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    }

    // Delay adding listener so the current click doesn't immediately close it
    const timer = setTimeout(() => {
      // Use capture phase so we intercept before the overlay's onMouseDown
      document.addEventListener("mousedown", handleOutsideClick, true);
    }, 0);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleOutsideClick, true);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  // Close popover on scroll (position would be stale)
  useEffect(() => {
    if (!open) return;
    function handleScroll() {
      setOpen(false);
    }
    // Capture phase to catch scroll on any container
    document.addEventListener("scroll", handleScroll, true);
    return () => document.removeEventListener("scroll", handleScroll, true);
  }, [open]);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      // Don't start drag if popover is open
      if (open) return;
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      didDragRef.current = false;

      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const startAnnX = annotation.x;
      const startAnnY = annotation.y;
      const pageW = dimension.width * zoom;
      const pageH = dimension.height * zoom;

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startMouseX;
        const dy = ev.clientY - startMouseY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) didDragRef.current = true;
        onUpdate({
          x: startAnnX + dx / pageW,
          y: startAnnY + dy / pageH,
        });
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [open, annotation.x, annotation.y, dimension, zoom, onUpdate, onSelect]
  );

  return (
    <div
      className={`sticky-note-wrapper${selected ? " annotation-selected" : ""}`}
      style={{ position: "absolute", left, top, pointerEvents: "auto" }}
    >
      <div
        ref={iconRef}
        className="sticky-note-icon"
        onMouseDown={handleDragStart}
        onClick={(e) => {
          e.stopPropagation();
          if (didDragRef.current) return;
          onSelect();
          if (open) {
            setOpen(false);
          } else {
            openPopover();
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onContextMenu(e.clientX, e.clientY);
        }}
        style={{ backgroundColor: annotation.color, cursor: open ? "pointer" : "move" }}
        title="Click to edit note"
      >
        📝
      </div>

      {open && createPortal(
        <div
          className="sticky-note-popover"
          ref={popoverRef}
          style={{
            position: "fixed",
            top: popoverPos.top,
            left: popoverPos.left,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <textarea
            ref={textareaRef}
            value={annotation.text}
            onChange={(e) => onUpdate({ text: e.target.value })}
            placeholder="Type a note…"
            rows={4}
          />
          <div className="sticky-note-actions">
            <button onClick={onDelete} className="sticky-note-delete">
              Delete
            </button>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
