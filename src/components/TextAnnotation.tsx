import { useCallback, useEffect, useRef, useState } from "react";
import type { TextAnnotation as TextAnnotationType, PageDimension } from "../types";

/** Convert stored text to HTML for display. Plain text gets \n→<br>; HTML passes through. */
function textToHtml(text: string): string {
  if (!text) return "";
  // If it already contains HTML tags, return as-is
  if (/<[a-z][\s\S]*?>/i.test(text)) return text;
  // Plain text: escape entities and convert newlines
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

/** Strip HTML tags to get plain text (for empty check) */
function htmlToPlainText(html: string): string {
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  return tmp.innerText;
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
  const didDragRef = useRef(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);

  const pageW = dimension.width * zoom;
  const pageH = dimension.height * zoom;
  const left = annotation.x * pageW;
  const top = annotation.y * pageH;
  const minWidth = 50;
  const width = Math.max(minWidth, annotation.width * pageW);
  const height = Math.max(20, annotation.height * pageH);

  // When entering edit mode, set content via innerHTML (preserves formatting)
  // and focus. Using innerHTML (not React children) avoids cursor resets.
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
        width: Math.max(minWidth, el.scrollWidth) / pageW,
        height: Math.max(20, el.scrollHeight) / pageH,
      });
    }, 1000);
  }, [pageW, pageH, onUpdate]);

  const handleBlur = useCallback(() => {
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
        width: Math.max(minWidth, el.scrollWidth) / pageW,
        height: Math.max(20, el.scrollHeight) / pageH,
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
      // Cmd/Ctrl+B, I, U for inline formatting
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

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, corner: string) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const startW = width;
      const startH = height;

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        let newW = startW;
        let newH = startH;

        if (corner.includes("r")) newW = Math.max(minWidth, startW + dx);
        if (corner.includes("l")) newW = Math.max(minWidth, startW - dx);
        if (corner.includes("b")) newH = Math.max(20, startH + dy);
        if (corner.includes("t")) newH = Math.max(20, startH - dy);

        const normW = newW / pageW;
        const normH = newH / pageH;

        let normX = annotation.x;
        let normY = annotation.y;
        if (corner.includes("l")) normX = annotation.x + annotation.width - normW;
        if (corner.includes("t")) normY = annotation.y + annotation.height - normH;

        onUpdate({ x: normX, y: normY, width: normW, height: normH });
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [annotation, pageW, pageH, width, height, onUpdate]
  );

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (editing) return;
      if ((e.target as HTMLElement).classList.contains("highlight-resize-handle")) return;
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      didDragRef.current = false;

      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const startAnnX = annotation.x;
      const startAnnY = annotation.y;

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
    [editing, annotation.x, annotation.y, pageW, pageH, onUpdate, onSelect]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (didDragRef.current) return;
      onSelect();
      if (!editing) setEditing(true);
    },
    [editing, onSelect]
  );

  // Close editing on outside click
  useEffect(() => {
    if (!editing) return;
    function handleOutsideClick(e: MouseEvent) {
      const target = e.target as Node;
      if (contentRef.current?.contains(target)) return;
      const wrapper = contentRef.current?.parentElement;
      if (wrapper?.contains(target)) return;
      // Don't close if clicking the annotation context menu
      if ((target as HTMLElement).closest?.(".annotation-context-menu")) return;
      e.stopPropagation();
      setEditing(false);
      const el = contentRef.current;
      if (!el) return;
      const plain = htmlToPlainText(el.innerHTML);
      if (plain.trim() === "") {
        onDelete();
      } else {
        onUpdate({
          text: el.innerHTML,
          width: Math.max(minWidth, el.scrollWidth) / pageW,
          height: Math.max(20, el.scrollHeight) / pageH,
        });
      }
    }
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleOutsideClick, true);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleOutsideClick, true);
    };
  }, [editing, onDelete, onUpdate, pageW, pageH]);

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
      className={`text-annotation${selected ? " annotation-selected" : ""}${editing ? " text-annotation-editing" : ""}`}
      style={{
        position: "absolute",
        left,
        top,
        minWidth: minWidth,
        minHeight: 20,
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
            minWidth: minWidth,
            minHeight: 20,
            lineHeight: 1.3,
            padding: "2px 4px",
          }}
          onInput={commitSize}
          onKeyDown={handleKeyDown}
          onBlur={handleBlur}
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
      {selected && !editing &&
        ["tl", "tr", "bl", "br"].map((corner) => (
          <div
            key={corner}
            className={`highlight-resize-handle highlight-resize-${corner}`}
            onMouseDown={(e) => handleResizeStart(e, corner)}
          />
        ))}
    </div>
  );
}
