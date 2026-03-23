import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, AnnotationTool, PageDimension } from "../types";
import { HighlightRect } from "./HighlightRect";
import { StickyNote } from "./StickyNote";
import { SignatureStamp } from "./SignatureStamp";

const HIGHLIGHT_COLORS = [
  { color: "#ffff00", label: "Yellow" },
  { color: "#ff6b6b", label: "Red" },
  { color: "#ffa500", label: "Orange" },
  { color: "#51cf66", label: "Green" },
  { color: "#339af0", label: "Blue" },
  { color: "#cc5de8", label: "Purple" },
  { color: "#f06595", label: "Pink" },
];

interface AnnotationOverlayProps {
  pageNumber: number;
  width: number;
  height: number;
  dimension: PageDimension;
  zoom: number;
  annotations: Annotation[];
  activeTool: AnnotationTool;
  highlightColor: string;
  onAddAnnotation: (annotation: Annotation) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  onDeleteAnnotation: (id: string) => void;
  pendingSignature?: string | null;
}

interface DragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface ContextMenuState {
  x: number;
  y: number;
  annotationId: string;
  annotationType: string;
}

export function AnnotationOverlay({
  pageNumber,
  width,
  height,
  dimension,
  zoom,
  annotations,
  activeTool,
  highlightColor,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  pendingSignature,
}: AnnotationOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [sigPreviewPos, setSigPreviewPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Deselect when clicking outside or when tool becomes active
  useEffect(() => {
    if (activeTool !== "none") {
      setSelectedId(null);
      setContextMenu(null);
    }
  }, [activeTool]);

  // Keyboard: Delete/Backspace removes selected annotation
  useEffect(() => {
    if (!selectedId) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Delete" || e.key === "Backspace") {
        // Don't intercept if user is typing in an input/textarea
        const tag = (e.target as HTMLElement).tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
        e.preventDefault();
        onDeleteAnnotation(selectedId!);
        setSelectedId(null);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [selectedId, onDeleteAnnotation]);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;
    function handleClick(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId(id);
    setContextMenu(null);
  }, []);

  const handleContextMenu = useCallback((id: string, x: number, y: number) => {
    const ann = annotations.find((a) => a.id === id);
    setSelectedId(id);
    setContextMenu({ x, y, annotationId: id, annotationType: ann?.type ?? "" });
  }, [annotations]);

  const handleContextMenuDelete = useCallback(() => {
    if (contextMenu) {
      onDeleteAnnotation(contextMenu.annotationId);
      setSelectedId(null);
      setContextMenu(null);
    }
  }, [contextMenu, onDeleteAnnotation]);

  const handleContextMenuRecolor = useCallback(
    (color: string) => {
      if (contextMenu) {
        onUpdateAnnotation(contextMenu.annotationId, { color });
        setContextMenu(null);
      }
    },
    [contextMenu, onUpdateAnnotation]
  );

  const handleMouseDown = (e: React.MouseEvent) => {
    // Click on empty area deselects
    const target = e.target as HTMLElement;
    if (
      !target.closest(".sticky-note-wrapper") &&
      !target.closest(".highlight-annotation") &&
      !target.closest(".signature-stamp") &&
      !target.closest(".annotation-context-menu")
    ) {
      setSelectedId(null);
      setContextMenu(null);
    }

    if (activeTool === "none") return;
    if (e.button !== 0) return;

    // Don't create new annotations when clicking on existing ones
    if (
      target.closest(".sticky-note-wrapper") ||
      target.closest(".highlight-annotation") ||
      target.closest(".signature-stamp")
    ) {
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

    if (activeTool === "signature" && pendingSignature) {
      const pageW = dimension.width * zoom;
      const pageH = dimension.height * zoom;
      // Default signature size: ~150px wide, proportional height
      const defaultW = 150 / pageW;
      const defaultH = 60 / pageH;
      const normX = x / pageW - defaultW / 2;
      const normY = y / pageH - defaultH / 2;
      onAddAnnotation({
        id: crypto.randomUUID(),
        type: "signature",
        pageNumber,
        x: Math.max(0, Math.min(1 - defaultW, normX)),
        y: Math.max(0, Math.min(1 - defaultH, normY)),
        width: defaultW,
        height: defaultH,
        imageData: pendingSignature,
      });
      return;
    }

    if (activeTool === "highlight") {
      setDrag({ startX: x, startY: y, currentX: x, currentY: y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (drag) {
      const rect = overlayRef.current!.getBoundingClientRect();
      setDrag({
        ...drag,
        currentX: e.clientX - rect.left,
        currentY: e.clientY - rect.top,
      });
    }

    // Show signature preview following cursor
    if (activeTool === "signature" && pendingSignature) {
      const rect = overlayRef.current!.getBoundingClientRect();
      setSigPreviewPos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }
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
        color: highlightColor,
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
              selected={selectedId === ann.id}
              onSelect={() => handleSelect(ann.id)}
              onUpdate={(updates) => onUpdateAnnotation(ann.id, updates)}
              onContextMenu={(x, y) => handleContextMenu(ann.id, x, y)}
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
              selected={selectedId === ann.id}
              onSelect={() => handleSelect(ann.id)}
              onUpdate={(updates) => onUpdateAnnotation(ann.id, updates)}
              onDelete={() => onDeleteAnnotation(ann.id)}
              onContextMenu={(x, y) => handleContextMenu(ann.id, x, y)}
            />
          );
        }
        if (ann.type === "signature") {
          return (
            <SignatureStamp
              key={ann.id}
              annotation={ann}
              dimension={dimension}
              zoom={zoom}
              selected={selectedId === ann.id}
              onSelect={() => handleSelect(ann.id)}
              onUpdate={(updates) => onUpdateAnnotation(ann.id, updates)}
              onContextMenu={(x, y) => handleContextMenu(ann.id, x, y)}
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
            backgroundColor: highlightColor,
            opacity: 0.25,
            border: `1px dashed ${highlightColor}`,
          }}
        />
      )}

      {/* Signature preview following cursor */}
      {activeTool === "signature" && pendingSignature && sigPreviewPos && (
        <img
          src={pendingSignature}
          alt="Signature preview"
          className="signature-preview"
          style={{
            position: "absolute",
            left: sigPreviewPos.x - 75,
            top: sigPreviewPos.y - 30,
            width: 150,
            height: 60,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="annotation-context-menu"
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
          }}
        >
          {contextMenu.annotationType === "highlight" && (
            <div className="annotation-color-swatches">
              {HIGHLIGHT_COLORS.map((c) => (
                <button
                  key={c.color}
                  className="annotation-color-swatch"
                  style={{ backgroundColor: c.color }}
                  title={c.label}
                  onClick={() => handleContextMenuRecolor(c.color)}
                />
              ))}
            </div>
          )}
          <button className="annotation-context-delete" onClick={handleContextMenuDelete}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
