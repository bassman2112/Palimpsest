import { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import type { StickyNoteAnnotation, PageDimension } from "../types";

interface StickyNoteProps {
  annotation: StickyNoteAnnotation;
  dimension: PageDimension;
  zoom: number;
  onUpdate: (updates: Partial<StickyNoteAnnotation>) => void;
  onDelete: () => void;
}

export function StickyNote({ annotation, dimension, zoom, onUpdate, onDelete }: StickyNoteProps) {
  // Auto-open for newly created (empty text) notes
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

  return (
    <div
      className="sticky-note-wrapper"
      style={{ position: "absolute", left, top, pointerEvents: "auto" }}
    >
      <div
        ref={iconRef}
        className="sticky-note-icon"
        onClick={(e) => {
          e.stopPropagation();
          if (open) {
            setOpen(false);
          } else {
            openPopover();
          }
        }}
        style={{ backgroundColor: annotation.color }}
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
