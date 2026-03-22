import { useRef, useState } from "react";
import type { Annotation, AnnotationTool, PageDimension } from "../types";
import { HighlightRect } from "./HighlightRect";
import { StickyNote } from "./StickyNote";

interface AnnotationOverlayProps {
  pageNumber: number;
  width: number;
  height: number;
  dimension: PageDimension;
  zoom: number;
  annotations: Annotation[];
  activeTool: AnnotationTool;
  onAddAnnotation: (annotation: Annotation) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  onDeleteAnnotation: (id: string) => void;
}

interface DragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export function AnnotationOverlay({
  pageNumber,
  width,
  height,
  dimension,
  zoom,
  annotations,
  activeTool,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
}: AnnotationOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (activeTool === "none") return;
    if (e.button !== 0) return;

    // Don't create new annotations when clicking on existing ones
    const target = e.target as HTMLElement;
    if (target.closest(".sticky-note-wrapper") || target.closest(".highlight-annotation")) {
      return;
    }

    const rect = overlayRef.current!.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (activeTool === "sticky-note") {
      const normX = x / (dimension.width * zoom);
      const normY = y / (dimension.height * zoom);
      onAddAnnotation({
        id: crypto.randomUUID(),
        type: "sticky-note",
        pageNumber,
        x: normX,
        y: normY,
        text: "",
        color: "#ffeb3b",
      });
      return;
    }

    if (activeTool === "highlight") {
      setDrag({ startX: x, startY: y, currentX: x, currentY: y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!drag) return;
    const rect = overlayRef.current!.getBoundingClientRect();
    setDrag({
      ...drag,
      currentX: e.clientX - rect.left,
      currentY: e.clientY - rect.top,
    });
  };

  const handleMouseUp = () => {
    if (!drag) return;

    const minX = Math.min(drag.startX, drag.currentX);
    const minY = Math.min(drag.startY, drag.currentY);
    const w = Math.abs(drag.currentX - drag.startX);
    const h = Math.abs(drag.currentY - drag.startY);

    // Ignore tiny drags (likely accidental clicks)
    if (w > 4 && h > 4) {
      const pageW = dimension.width * zoom;
      const pageH = dimension.height * zoom;
      onAddAnnotation({
        id: crypto.randomUUID(),
        type: "highlight",
        pageNumber,
        x: minX / pageW,
        y: minY / pageH,
        width: w / pageW,
        height: h / pageH,
        color: "#ffff00",
      });
    }

    setDrag(null);
  };

  const isToolActive = activeTool !== "none";

  return (
    <div
      ref={overlayRef}
      className={`annotation-overlay ${isToolActive ? "tool-active-overlay" : ""}`}
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width,
        height,
        pointerEvents: isToolActive ? "auto" : "none",
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {annotations.map((ann) => {
        if (ann.type === "highlight") {
          return (
            <HighlightRect
              key={ann.id}
              annotation={ann}
              dimension={dimension}
              zoom={zoom}
              onClick={() => {}}
              onDelete={() => onDeleteAnnotation(ann.id)}
            />
          );
        }
        if (ann.type === "sticky-note") {
          return (
            <StickyNote
              key={ann.id}
              annotation={ann}
              dimension={dimension}
              zoom={zoom}
              onUpdate={(updates) => onUpdateAnnotation(ann.id, updates)}
              onDelete={() => onDeleteAnnotation(ann.id)}
            />
          );
        }
        return null;
      })}

      {/* Highlight preview while dragging */}
      {drag && (
        <div
          className="highlight-preview"
          style={{
            position: "absolute",
            left: Math.min(drag.startX, drag.currentX),
            top: Math.min(drag.startY, drag.currentY),
            width: Math.abs(drag.currentX - drag.startX),
            height: Math.abs(drag.currentY - drag.startY),
          }}
        />
      )}
    </div>
  );
}
