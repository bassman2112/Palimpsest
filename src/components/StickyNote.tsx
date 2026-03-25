import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { StickyNoteAnnotation, PageDimension } from "../types";
import { useDragToMove } from "../hooks/useDragToMove";
import { useOutsideClick } from "../hooks/useOutsideClick";

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
  const [open, setOpen] = useState(() => annotation.text === "");
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });
  const popoverRef = useRef<HTMLDivElement>(null);
  const iconRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Close popover on outside click
  const handleClosePopover = useCallback(() => setOpen(false), []);
  useOutsideClick([popoverRef, iconRef], open, handleClosePopover);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  // Close popover on scroll (position would be stale)
  useEffect(() => {
    if (!open) return;
    function handleScroll() {
      setOpen(false);
    }
    document.addEventListener("scroll", handleScroll, true);
    return () => document.removeEventListener("scroll", handleScroll, true);
  }, [open]);

  const { didDragRef, handleDragStart } = useDragToMove({
    position: { x: annotation.x, y: annotation.y },
    dimension,
    zoom,
    onSelect,
    onUpdate: onUpdate as (updates: Record<string, unknown>) => void,
    disabled: open,
  });

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
