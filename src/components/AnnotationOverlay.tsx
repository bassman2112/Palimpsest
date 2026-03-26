import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, AnnotationTool, PageDimension } from "../types";
import { HighlightRect } from "./HighlightRect";
import { StickyNote } from "./StickyNote";
import { SignatureStamp } from "./SignatureStamp";
import { TextMarkup } from "./TextMarkup";
import { InkStroke } from "./InkStroke";
import { ShapeAnnotation } from "./ShapeAnnotation";
import { TextAnnotationComponent } from "./TextAnnotation";
import { RedactionRect } from "./RedactionRect";
import { AnnotationContextMenu } from "./AnnotationContextMenu";
import { DragPreview } from "./DragPreview";
import { useInkDrawing } from "../hooks/useInkDrawing";
import {
  DEFAULT_STICKY_COLOR,
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_SIZE,
  DEFAULT_HIGHLIGHT_COLOR,
  DEFAULT_SIGNATURE_SIZE,
} from "../constants";

interface AnnotationOverlayProps {
  pageNumber: number;
  width: number;
  height: number;
  dimension: PageDimension;
  zoom: number;
  annotations: Annotation[];
  activeTool: AnnotationTool;
  highlightColor: string;
  strokeWidth: number;
  onAddAnnotation: (annotation: Annotation) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  onDeleteAnnotation: (id: string) => void;
  onApplyRedaction?: (annotationId: string) => void;
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
  strokeWidth,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  onApplyRedaction,
  pendingSignature,
}: AnnotationOverlayProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [sigPreviewPos, setSigPreviewPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const { inkDrawingRef, inkCanvasRef, inkStartStroke, inkAddPoint, inkEndStroke } = useInkDrawing({
    activeTool,
    highlightColor,
    strokeWidth,
    dimension,
    zoom,
    pageNumber,
    onAddAnnotation,
  });

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

  const handleMouseDown = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (
      !target.closest(".sticky-note-wrapper") &&
      !target.closest(".highlight-annotation") &&
      !target.closest(".signature-stamp") &&
      !target.closest(".text-markup-annotation") &&
      !target.closest(".ink-annotation") &&
      !target.closest(".shape-annotation") &&
      !target.closest(".text-annotation") &&
      !target.closest(".redaction-annotation") &&
      !target.closest(".annotation-context-menu")
    ) {
      setSelectedId(null);
      setContextMenu(null);
    }

    if (activeTool === "none") return;
    if (e.button !== 0) return;

    if (
      target.closest(".sticky-note-wrapper") ||
      target.closest(".highlight-annotation") ||
      target.closest(".signature-stamp") ||
      target.closest(".text-markup-annotation") ||
      target.closest(".ink-annotation") ||
      target.closest(".shape-annotation") ||
      target.closest(".text-annotation") ||
      target.closest(".redaction-annotation") ||
      target.closest(".annotation-context-menu")
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
        color: DEFAULT_STICKY_COLOR,
      });
      return;
    }

    if (activeTool === "text") {
      const normX = x / (dimension.width * zoom);
      const normY = y / (dimension.height * zoom);
      onAddAnnotation({
        id: crypto.randomUUID(),
        type: "text",
        pageNumber,
        x: normX,
        y: normY,
        width: DEFAULT_TEXT_SIZE.width / (dimension.width * zoom),
        height: DEFAULT_TEXT_SIZE.height / (dimension.height * zoom),
        text: "",
        color: DEFAULT_TEXT_COLOR,
        fontSize: 16,
        fontFamily: "sans-serif",
        bold: false,
        italic: false,
        underline: false,
        backgroundColor: "transparent",
      });
      return;
    }

    if (activeTool === "signature" && pendingSignature) {
      const pageW = dimension.width * zoom;
      const pageH = dimension.height * zoom;
      const defaultW = DEFAULT_SIGNATURE_SIZE.width / pageW;
      const defaultH = DEFAULT_SIGNATURE_SIZE.height / pageH;
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

    if (activeTool === "highlight" || activeTool === "underline" || activeTool === "strikethrough"
      || activeTool === "redaction"
      || activeTool === "shape-rectangle" || activeTool === "shape-ellipse"
      || activeTool === "shape-line" || activeTool === "shape-arrow") {
      setDrag({ startX: x, startY: y, currentX: x, currentY: y });
    }

    if (activeTool === "ink") {
      inkStartStroke(x, y);
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

    if (activeTool === "signature" && pendingSignature) {
      const rect = overlayRef.current!.getBoundingClientRect();
      setSigPreviewPos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }

    if (activeTool === "ink" && inkDrawingRef.current) {
      const rect = overlayRef.current!.getBoundingClientRect();
      inkAddPoint(e.clientX - rect.left, e.clientY - rect.top);
    }
  };

  const handleMouseUp = () => {
    if (activeTool === "ink" && inkDrawingRef.current) {
      inkEndStroke();
      return;
    }

    if (!drag) return;

    const minX = Math.min(drag.startX, drag.currentX);
    const minY = Math.min(drag.startY, drag.currentY);
    const w = Math.abs(drag.currentX - drag.startX);
    const h = Math.abs(drag.currentY - drag.startY);

    const isShapeTool = activeTool === "shape-rectangle" || activeTool === "shape-ellipse"
      || activeTool === "shape-line" || activeTool === "shape-arrow";

    const meetsThreshold = isShapeTool ? (w > 4 || h > 4) : (w > 4 && h > 4);

    if (meetsThreshold) {
      const pageW = dimension.width * zoom;
      const pageH = dimension.height * zoom;

      if (isShapeTool) {
        const shapeColor = highlightColor === DEFAULT_HIGHLIGHT_COLOR ? DEFAULT_TEXT_COLOR : highlightColor;
        const shapeKind = activeTool.replace("shape-", "") as "rectangle" | "ellipse" | "line" | "arrow";
        onAddAnnotation({
          id: crypto.randomUUID(),
          type: "shape",
          shape: shapeKind,
          pageNumber,
          x1: drag.startX / pageW,
          y1: drag.startY / pageH,
          x2: drag.currentX / pageW,
          y2: drag.currentY / pageH,
          color: shapeColor,
          strokeWidth,
        });
      } else if (activeTool === "redaction") {
        onAddAnnotation({
          id: crypto.randomUUID(),
          type: "redaction",
          pageNumber,
          x: minX / pageW,
          y: minY / pageH,
          width: w / pageW,
          height: h / pageH,
        });
      } else if (activeTool === "underline" || activeTool === "strikethrough") {
        const markupColor = highlightColor === DEFAULT_HIGHLIGHT_COLOR ? DEFAULT_TEXT_COLOR : highlightColor;
        onAddAnnotation({
          id: crypto.randomUUID(),
          type: activeTool,
          pageNumber,
          x: minX / pageW,
          y: minY / pageH,
          width: w / pageW,
          height: h / pageH,
          color: markupColor,
        });
      } else {
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
        if (ann.type === "underline" || ann.type === "strikethrough") {
          return (
            <TextMarkup
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
        if (ann.type === "ink") {
          return (
            <InkStroke
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
        if (ann.type === "shape") {
          return (
            <ShapeAnnotation
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
        if (ann.type === "redaction") {
          return (
            <RedactionRect
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
        if (ann.type === "text") {
          return (
            <TextAnnotationComponent
              key={ann.id}
              annotation={ann}
              dimension={dimension}
              zoom={zoom}
              selected={selectedId === ann.id}
              autoEdit={ann.text === ""}
              onSelect={() => handleSelect(ann.id)}
              onUpdate={(updates) => onUpdateAnnotation(ann.id, updates)}
              onDelete={() => onDeleteAnnotation(ann.id)}
              onContextMenu={(x, y) => handleContextMenu(ann.id, x, y)}
            />
          );
        }
        return null;
      })}

      <DragPreview
        drag={drag}
        activeTool={activeTool}
        highlightColor={highlightColor}
        strokeWidth={strokeWidth}
        pendingSignature={pendingSignature}
        sigPreviewPos={sigPreviewPos}
      />

      {/* Ink live drawing canvas */}
      {activeTool === "ink" && (
        <canvas
          ref={inkCanvasRef}
          className="ink-live-canvas"
          width={width}
          height={height}
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width,
            height,
            pointerEvents: "none",
          }}
        />
      )}

      {/* Right-click context menu */}
      {contextMenu && (
        <AnnotationContextMenu
          ref={contextMenuRef}
          contextMenu={contextMenu}
          annotations={annotations}
          onUpdateAnnotation={onUpdateAnnotation}
          onDeleteAnnotation={(id) => {
            onDeleteAnnotation(id);
            setSelectedId(null);
          }}
          onApplyRedaction={onApplyRedaction}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
