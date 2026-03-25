import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TextAnnotation as TextAnnotationType, PageDimension } from "../types";
import { MIN_TEXT_WIDTH, MIN_TEXT_HEIGHT } from "../constants";
import { htmlToPlainText } from "../lib/utils";
import { useDragToMove } from "../hooks/useDragToMove";
import { useResizeHandles } from "../hooks/useResizeHandles";
import { useOutsideClick } from "../hooks/useOutsideClick";

/** Convert stored text to HTML for display. Plain text gets \n→<br>; HTML passes through. */
function textToHtml(text: string): string {
  if (!text) return "";
  if (/<[a-z][\s\S]*?>/i.test(text)) return text;
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

interface TextAnnotationProps {
  annotation: TextAnnotationType;
  dimension: PageDimension;
  zoom: number;
  selected: boolean;
  autoEdit?: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<TextAnnotationType>) => void;
  onDelete: () => void;
  onContextMenu: (x: number, y: number) => void;
}

export function TextAnnotationComponent({
  annotation,
  dimension,
  zoom,
  selected,
  autoEdit,
  onSelect,
  onUpdate,
  onDelete,
  onContextMenu,
}: TextAnnotationProps) {
  const [editing, setEditing] = useState(() => autoEdit ?? false);
  const contentRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);

  const pageW = dimension.width * zoom;
  const pageH = dimension.height * zoom;
  const left = annotation.x * pageW;
  const top = annotation.y * pageH;
  const width = Math.max(MIN_TEXT_WIDTH, annotation.width * pageW);
  const height = Math.max(MIN_TEXT_HEIGHT, annotation.height * pageH);

  // When entering edit mode, set content via innerHTML and focus
  useEffect(() => {
    if (editing && contentRef.current) {
      if (!initializedRef.current) {
        contentRef.current.innerHTML = textToHtml(annotation.text);
        initializedRef.current = true;
      }
      requestAnimationFrame(() => {
        contentRef.current?.focus();
        const sel = window.getSelection();
        if (sel && contentRef.current) {
          sel.selectAllChildren(contentRef.current);
          sel.collapseToEnd();
        }
      });
    }
    if (!editing) {
      initializedRef.current = false;
    }
  }, [editing]); // deliberately omit annotation.text

  useEffect(() => {
    if (autoEdit) setEditing(true);
  }, [autoEdit]);

  const commitSize = useCallback(() => {
    if (!contentRef.current) return;
    const el = contentRef.current;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onUpdate({
        text: el.innerHTML,
        width: Math.max(MIN_TEXT_WIDTH, el.scrollWidth) / pageW,
        height: Math.max(MIN_TEXT_HEIGHT, el.scrollHeight) / pageH,
      });
    }, 1000);
  }, [pageW, pageH, onUpdate]);

  const commitAndClose = useCallback(() => {
    setEditing(false);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const el = contentRef.current;
    if (!el) return;
    const plain = htmlToPlainText(el.innerHTML);
    if (plain.trim() === "") {
      onDelete();
    } else {
      onUpdate({
        text: el.innerHTML,
        width: Math.max(MIN_TEXT_WIDTH, el.scrollWidth) / pageW,
        height: Math.max(MIN_TEXT_HEIGHT, el.scrollHeight) / pageH,
      });
    }
  }, [onDelete, onUpdate, pageW, pageH]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        (e.target as HTMLElement).blur();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey) {
        if (e.key === "b") {
          e.preventDefault();
          document.execCommand("bold");
        } else if (e.key === "i") {
          e.preventDefault();
          document.execCommand("italic");
        } else if (e.key === "u") {
          e.preventDefault();
          document.execCommand("underline");
        }
      }
      e.stopPropagation();
    },
    []
  );

  const { didDragRef, handleDragStart } = useDragToMove({
    position: { x: annotation.x, y: annotation.y },
    dimension,
    zoom,
    onSelect,
    onUpdate: onUpdate as (updates: Record<string, unknown>) => void,
    guardSelector: "highlight-resize-handle",
    disabled: editing,
  });

  const { ResizeHandles } = useResizeHandles({
    rect: { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height },
    pixelSize: { width, height },
    dimension,
    zoom,
    onUpdate: onUpdate as (updates: Record<string, unknown>) => void,
    minWidth: MIN_TEXT_WIDTH,
    minHeight: MIN_TEXT_HEIGHT,
  });

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (didDragRef.current) return;
      onSelect();
      if (!editing) setEditing(true);
    },
    [editing, onSelect, didDragRef]
  );

  // Close editing on outside click
  const wrapperRef = useRef<HTMLDivElement>(null);
  const outsideClickRefs = useMemo(() => [contentRef, wrapperRef], []);
  useOutsideClick(
    outsideClickRefs,
    editing,
    commitAndClose,
    [".annotation-context-menu"],
  );

  const fontStyle = {
    color: annotation.color,
    fontSize: annotation.fontSize * zoom,
    fontFamily:
      annotation.fontFamily === "serif"
        ? "Georgia, 'Times New Roman', serif"
        : annotation.fontFamily === "monospace"
          ? "'Courier New', Courier, monospace"
          : "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    fontWeight: annotation.bold ? "bold" : ("normal" as const),
    fontStyle: annotation.italic ? "italic" : ("normal" as const),
    textDecoration: annotation.underline ? "underline" : ("none" as const),
  };

  const bgColor = annotation.backgroundColor && annotation.backgroundColor !== "transparent"
    ? annotation.backgroundColor
    : undefined;

  return (
    <div
      ref={wrapperRef}
      className={`text-annotation${selected ? " annotation-selected" : ""}${editing ? " text-annotation-editing" : ""}`}
      style={{
        position: "absolute",
        left,
        top,
        minWidth: MIN_TEXT_WIDTH,
        minHeight: MIN_TEXT_HEIGHT,
        width: editing ? "auto" : width,
        height: editing ? "auto" : undefined,
        pointerEvents: "auto",
        cursor: editing ? "text" : "move",
        background: bgColor,
      }}
      onMouseDown={handleDragStart}
      onClick={handleClick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e.clientX, e.clientY);
      }}
    >
      {editing ? (
        <div
          ref={contentRef}
          className="text-annotation-content"
          contentEditable
          suppressContentEditableWarning
          style={{
            ...fontStyle,
            outline: "none",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            minWidth: MIN_TEXT_WIDTH,
            minHeight: MIN_TEXT_HEIGHT,
            lineHeight: 1.3,
            padding: "2px 4px",
          }}
          onInput={commitSize}
          onKeyDown={handleKeyDown}
          onBlur={commitAndClose}
        />
      ) : (
        <div
          className="text-annotation-content"
          style={{
            ...fontStyle,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            lineHeight: 1.3,
            padding: "2px 4px",
            userSelect: "none",
          }}
          dangerouslySetInnerHTML={{ __html: textToHtml(annotation.text) || "\u00A0" }}
        />
      )}
      {selected && !editing && <ResizeHandles />}
    </div>
  );
}
