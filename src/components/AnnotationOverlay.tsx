import { useCallback, useEffect, useRef, useState } from "react";
import type { Annotation, AnnotationTool, PageDimension } from "../types";
import { HighlightRect } from "./HighlightRect";
import { StickyNote } from "./StickyNote";
import { SignatureStamp } from "./SignatureStamp";
import { TextMarkup } from "./TextMarkup";
import { InkStroke } from "./InkStroke";
import { ShapeAnnotation } from "./ShapeAnnotation";
import { TextAnnotationComponent } from "./TextAnnotation";

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
  strokeWidth: number;
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
  strokeWidth,
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

  // Ink drawing state (ref-based for performance during mousemove)
  const inkDrawingRef = useRef(false);
  const inkCanvasRef = useRef<HTMLCanvasElement>(null);
  const inkPointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const inkStrokesRef = useRef<Array<Array<{ x: number; y: number }>>>([]);
  const [, setInkVersion] = useState(0); // trigger re-render for completed strokes

  const inkStartStroke = useCallback((x: number, y: number) => {
    inkDrawingRef.current = true;
    inkPointsRef.current = [{ x, y }];

    // Draw initial point on canvas
    const canvas = inkCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.strokeStyle = highlightColor;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(x, y);
      }
    }
  }, [highlightColor, strokeWidth]);

  const inkAddPoint = useCallback((x: number, y: number) => {
    inkPointsRef.current.push({ x, y });
    const canvas = inkCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.lineTo(x, y);
        ctx.stroke();
      }
    }
  }, []);

  const inkEndStroke = useCallback(() => {
    inkDrawingRef.current = false;
    const points = inkPointsRef.current;
    if (points.length < 2) return;

    inkStrokesRef.current.push([...points]);
    inkPointsRef.current = [];

    // Clear the live canvas
    const canvas = inkCanvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // Redraw all completed strokes on the canvas
    if (canvas && inkStrokesRef.current.length > 0) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.strokeStyle = highlightColor;
        ctx.lineWidth = strokeWidth;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (const stroke of inkStrokesRef.current) {
          ctx.beginPath();
          ctx.moveTo(stroke[0].x, stroke[0].y);
          for (let i = 1; i < stroke.length; i++) {
            ctx.lineTo(stroke[i].x, stroke[i].y);
          }
          ctx.stroke();
        }
      }
    }

    setInkVersion((v) => v + 1);
  }, [highlightColor, strokeWidth]);

  // Commit all accumulated ink strokes into one annotation when tool changes away from ink
  const prevToolRef = useRef(activeTool);
  useEffect(() => {
    if (prevToolRef.current === "ink" && activeTool !== "ink") {
      const strokes = inkStrokesRef.current;
      if (strokes.length > 0) {
        const pageW = dimension.width * zoom;
        const pageH = dimension.height * zoom;

        // Compute bounding box from all points
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const stroke of strokes) {
          for (const pt of stroke) {
            if (pt.x < minX) minX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y > maxY) maxY = pt.y;
          }
        }

        // Normalize all points to page coords (0-1)
        const normPaths = strokes.map((stroke) =>
          stroke.map((pt) => ({
            x: pt.x / pageW,
            y: pt.y / pageH,
          }))
        );

        onAddAnnotation({
          id: crypto.randomUUID(),
          type: "ink",
          pageNumber,
          x: minX / pageW,
          y: minY / pageH,
          width: (maxX - minX) / pageW,
          height: (maxY - minY) / pageH,
          paths: normPaths,
          color: highlightColor,
          strokeWidth,
        });

        inkStrokesRef.current = [];
        // Clear canvas
        const canvas = inkCanvasRef.current;
        if (canvas) {
          const ctx = canvas.getContext("2d");
          if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
        }
      }
    }
    prevToolRef.current = activeTool;
  }, [activeTool, dimension, zoom, pageNumber, highlightColor, strokeWidth, onAddAnnotation]);

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
      !target.closest(".text-markup-annotation") &&
      !target.closest(".ink-annotation") &&
      !target.closest(".shape-annotation") &&
      !target.closest(".text-annotation") &&
      !target.closest(".annotation-context-menu")
    ) {
      setSelectedId(null);
      setContextMenu(null);
    }

    if (activeTool === "none") return;
    if (e.button !== 0) return;

    // Don't create new annotations when clicking on existing ones or context menu
    if (
      target.closest(".sticky-note-wrapper") ||
      target.closest(".highlight-annotation") ||
      target.closest(".signature-stamp") ||
      target.closest(".text-markup-annotation") ||
      target.closest(".ink-annotation") ||
      target.closest(".shape-annotation") ||
      target.closest(".text-annotation") ||
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
        color: "#ffeb3b",
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
        width: 50 / (dimension.width * zoom),
        height: 20 / (dimension.height * zoom),
        text: "",
        color: "#000000",
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

    if (activeTool === "highlight" || activeTool === "underline" || activeTool === "strikethrough"
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

    // Show signature preview following cursor
    if (activeTool === "signature" && pendingSignature) {
      const rect = overlayRef.current!.getBoundingClientRect();
      setSigPreviewPos({
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
      });
    }

    // Ink drawing
    if (activeTool === "ink" && inkDrawingRef.current) {
      const rect = overlayRef.current!.getBoundingClientRect();
      inkAddPoint(e.clientX - rect.left, e.clientY - rect.top);
    }
  };

  const handleMouseUp = () => {
    // Ink stroke end
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

    // Ignore tiny drags (likely accidental clicks)
    // Use || for threshold since lines can be horizontal/vertical
    const meetsThreshold = isShapeTool ? (w > 4 || h > 4) : (w > 4 && h > 4);

    if (meetsThreshold) {
      const pageW = dimension.width * zoom;
      const pageH = dimension.height * zoom;

      if (isShapeTool) {
        const shapeColor = highlightColor === "#ffff00" ? "#000000" : highlightColor;
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
      } else if (activeTool === "underline" || activeTool === "strikethrough") {
        const markupColor = highlightColor === "#ffff00" ? "#000000" : highlightColor;
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

      {/* Drag preview while dragging */}
      {drag && (activeTool === "underline" || activeTool === "strikethrough") && (() => {
        const previewLeft = Math.min(drag.startX, drag.currentX);
        const previewTop = Math.min(drag.startY, drag.currentY);
        const previewW = Math.abs(drag.currentX - drag.startX);
        const previewH = Math.abs(drag.currentY - drag.startY);
        const lineOffset = activeTool === "strikethrough" ? previewH / 2 : previewH - 1;
        const previewColor = highlightColor === "#ffff00" ? "#000000" : highlightColor;
        return (
          <div
            className="highlight-preview"
            style={{
              position: "absolute",
              left: previewLeft,
              top: previewTop,
              width: previewW,
              height: previewH,
              border: `1px dashed ${previewColor}`,
            }}
          >
            <div style={{
              position: "absolute",
              left: 0,
              top: lineOffset,
              width: "100%",
              height: 2,
              backgroundColor: previewColor,
              opacity: 0.8,
            }} />
          </div>
        );
      })()}
      {drag && (activeTool === "shape-rectangle" || activeTool === "shape-ellipse"
        || activeTool === "shape-line" || activeTool === "shape-arrow") && (() => {
        const previewColor = highlightColor === "#ffff00" ? "#000000" : highlightColor;
        const sx = drag.startX;
        const sy = drag.startY;
        const cx = drag.currentX;
        const cy = drag.currentY;
        const svgLeft = Math.min(sx, cx);
        const svgTop = Math.min(sy, cy);
        const svgW = Math.abs(cx - sx);
        const svgH = Math.abs(cy - sy);
        return (
          <svg
            className="highlight-preview"
            style={{ position: "absolute", left: svgLeft, top: svgTop, width: svgW, height: svgH, overflow: "visible", pointerEvents: "none" }}
            width={svgW}
            height={svgH}
          >
            {activeTool === "shape-rectangle" && (
              <rect x={0} y={0} width={svgW} height={svgH} fill="none" stroke={previewColor} strokeWidth={strokeWidth} strokeDasharray="6 3" />
            )}
            {activeTool === "shape-ellipse" && (
              <ellipse cx={svgW / 2} cy={svgH / 2} rx={svgW / 2} ry={svgH / 2} fill="none" stroke={previewColor} strokeWidth={strokeWidth} strokeDasharray="6 3" />
            )}
            {(activeTool === "shape-line" || activeTool === "shape-arrow") && (
              <line x1={sx - svgLeft} y1={sy - svgTop} x2={cx - svgLeft} y2={cy - svgTop} stroke={previewColor} strokeWidth={strokeWidth} strokeDasharray="6 3" />
            )}
          </svg>
        );
      })()}
      {drag && activeTool !== "underline" && activeTool !== "strikethrough"
        && activeTool !== "shape-rectangle" && activeTool !== "shape-ellipse"
        && activeTool !== "shape-line" && activeTool !== "shape-arrow" && (
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
        <div
          ref={contextMenuRef}
          className="annotation-context-menu"
          style={{
            position: "fixed",
            left: contextMenu.x,
            top: contextMenu.y,
          }}
        >
          {(contextMenu.annotationType === "highlight" ||
            contextMenu.annotationType === "underline" ||
            contextMenu.annotationType === "strikethrough" ||
            contextMenu.annotationType === "ink" ||
            contextMenu.annotationType === "shape" ||
            contextMenu.annotationType === "text") && (
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
              {contextMenu.annotationType === "text" && (
                <button
                  className="annotation-color-swatch"
                  style={{ backgroundColor: "#000000" }}
                  title="Black"
                  onClick={() => handleContextMenuRecolor("#000000")}
                />
              )}
            </div>
          )}
          {contextMenu.annotationType === "text" && (() => {
            const ann = annotations.find((a) => a.id === contextMenu.annotationId);
            const textAnn = ann?.type === "text" ? ann : null;
            return (
              <>
                <div className="annotation-font-sizes">
                  {[10, 12, 14, 18, 24, 36].map((s) => (
                    <button
                      key={s}
                      className={`annotation-font-size-btn${textAnn?.fontSize === s ? " active" : ""}`}
                      onClick={() => {
                        onUpdateAnnotation(contextMenu.annotationId, { fontSize: s } as Partial<Annotation>);
                        setContextMenu(null);
                      }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                <div className="annotation-font-toggles">
                  <button
                    className={`annotation-font-toggle-btn${textAnn?.bold ? " active" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const active = document.activeElement;
                      const isEditing = active?.getAttribute("contenteditable") === "true"
                        && active.closest(".text-annotation");
                      if (isEditing && window.getSelection()?.toString()) {
                        document.execCommand("bold");
                      } else {
                        onUpdateAnnotation(contextMenu.annotationId, { bold: !textAnn?.bold } as Partial<Annotation>);
                      }
                      setContextMenu(null);
                    }}
                  >
                    <b>B</b>
                  </button>
                  <button
                    className={`annotation-font-toggle-btn${textAnn?.italic ? " active" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const active = document.activeElement;
                      const isEditing = active?.getAttribute("contenteditable") === "true"
                        && active.closest(".text-annotation");
                      if (isEditing && window.getSelection()?.toString()) {
                        document.execCommand("italic");
                      } else {
                        onUpdateAnnotation(contextMenu.annotationId, { italic: !textAnn?.italic } as Partial<Annotation>);
                      }
                      setContextMenu(null);
                    }}
                  >
                    <i>I</i>
                  </button>
                  <button
                    className={`annotation-font-toggle-btn${textAnn?.underline ? " active" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const active = document.activeElement;
                      const isEditing = active?.getAttribute("contenteditable") === "true"
                        && active.closest(".text-annotation");
                      if (isEditing && window.getSelection()?.toString()) {
                        document.execCommand("underline");
                      } else {
                        onUpdateAnnotation(contextMenu.annotationId, { underline: !textAnn?.underline } as Partial<Annotation>);
                      }
                      setContextMenu(null);
                    }}
                  >
                    <span style={{ textDecoration: "underline" }}>U</span>
                  </button>
                </div>
                <div className="annotation-font-families">
                  {([["sans-serif", "Sans-serif"], ["serif", "Serif"], ["monospace", "Monospace"]] as const).map(([val, label]) => (
                    <button
                      key={val}
                      className={`annotation-font-family-btn${textAnn?.fontFamily === val ? " active" : ""}`}
                      onClick={() => {
                        onUpdateAnnotation(contextMenu.annotationId, { fontFamily: val } as Partial<Annotation>);
                        setContextMenu(null);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="annotation-bg-colors">
                  <span className="annotation-bg-label">Background</span>
                  {[
                    { value: "transparent", label: "None", css: "transparent" },
                    { value: "rgba(254, 240, 138, 0.5)", label: "Yellow", css: "#fef08a" },
                    { value: "rgba(147, 197, 253, 0.5)", label: "Blue", css: "#93c5fd" },
                    { value: "rgba(134, 239, 172, 0.5)", label: "Green", css: "#86efac" },
                    { value: "rgba(252, 165, 165, 0.5)", label: "Red", css: "#fca5a5" },
                    { value: "rgba(216, 180, 254, 0.5)", label: "Purple", css: "#d8b4fe" },
                    { value: "rgba(253, 186, 116, 0.5)", label: "Orange", css: "#fdba74" },
                  ].map((bg) => (
                    <button
                      key={bg.value}
                      className={`annotation-bg-swatch${textAnn?.backgroundColor === bg.value ? " active" : ""}`}
                      style={{
                        backgroundColor: bg.css,
                        border: bg.value === "transparent" ? "2px solid #ccc" : "2px solid transparent",
                      }}
                      title={bg.label}
                      onClick={() => {
                        onUpdateAnnotation(contextMenu.annotationId, { backgroundColor: bg.value } as Partial<Annotation>);
                        setContextMenu(null);
                      }}
                    />
                  ))}
                </div>
              </>
            );
          })()}
          {(contextMenu.annotationType === "shape" || contextMenu.annotationType === "ink") && (
            <div className="annotation-stroke-widths">
              {[1, 2, 3, 5, 8].map((w) => (
                <button
                  key={w}
                  className="annotation-stroke-option"
                  title={`${w}px`}
                  onClick={() => {
                    if (contextMenu) {
                      onUpdateAnnotation(contextMenu.annotationId, { strokeWidth: w } as Partial<Annotation>);
                      setContextMenu(null);
                    }
                  }}
                >
                  <svg width="32" height="16" viewBox="0 0 32 16">
                    <line x1="4" y1="8" x2="28" y2="8" stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
                  </svg>
                </button>
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
