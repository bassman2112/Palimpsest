import type { AnnotationTool } from "../types";
import { DEFAULT_HIGHLIGHT_COLOR, DEFAULT_TEXT_COLOR, DEFAULT_SIGNATURE_SIZE } from "../constants";

interface DragState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface DragPreviewProps {
  drag: DragState | null;
  activeTool: AnnotationTool;
  highlightColor: string;
  strokeWidth: number;
  pendingSignature?: string | null;
  sigPreviewPos: { x: number; y: number } | null;
}

export function DragPreview({
  drag,
  activeTool,
  highlightColor,
  strokeWidth,
  pendingSignature,
  sigPreviewPos,
}: DragPreviewProps) {
  return (
    <>
      {/* Underline / Strikethrough preview */}
      {drag && (activeTool === "underline" || activeTool === "strikethrough") && (() => {
        const previewLeft = Math.min(drag.startX, drag.currentX);
        const previewTop = Math.min(drag.startY, drag.currentY);
        const previewW = Math.abs(drag.currentX - drag.startX);
        const previewH = Math.abs(drag.currentY - drag.startY);
        const lineOffset = activeTool === "strikethrough" ? previewH / 2 : previewH - 1;
        const previewColor = highlightColor === DEFAULT_HIGHLIGHT_COLOR ? DEFAULT_TEXT_COLOR : highlightColor;
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

      {/* Shape preview */}
      {drag && (activeTool === "shape-rectangle" || activeTool === "shape-ellipse"
        || activeTool === "shape-line" || activeTool === "shape-arrow") && (() => {
        const previewColor = highlightColor === DEFAULT_HIGHLIGHT_COLOR ? DEFAULT_TEXT_COLOR : highlightColor;
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

      {/* Redaction preview */}
      {drag && activeTool === "redaction" && (
        <div
          className="highlight-preview"
          style={{
            position: "absolute",
            left: Math.min(drag.startX, drag.currentX),
            top: Math.min(drag.startY, drag.currentY),
            width: Math.abs(drag.currentX - drag.startX),
            height: Math.abs(drag.currentY - drag.startY),
            backgroundColor: "rgba(220, 38, 38, 0.3)",
            border: "2px dashed rgba(220, 38, 38, 0.7)",
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(220, 38, 38, 0.15) 4px, rgba(220, 38, 38, 0.15) 8px)",
          }}
        />
      )}

      {/* Highlight preview */}
      {drag && activeTool !== "underline" && activeTool !== "strikethrough"
        && activeTool !== "redaction"
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
            left: sigPreviewPos.x - DEFAULT_SIGNATURE_SIZE.width / 2,
            top: sigPreviewPos.y - DEFAULT_SIGNATURE_SIZE.height / 2,
            width: DEFAULT_SIGNATURE_SIZE.width,
            height: DEFAULT_SIGNATURE_SIZE.height,
            pointerEvents: "none",
          }}
        />
      )}
    </>
  );
}
