import { useCallback, useRef } from "react";
import type { ShapeAnnotation as ShapeAnnotationType, PageDimension } from "../types";
import { DRAG_THRESHOLD, SHAPE_PADDING } from "../constants";

interface ShapeAnnotationProps {
  annotation: ShapeAnnotationType;
  dimension: PageDimension;
  zoom: number;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<ShapeAnnotationType>) => void;
  onContextMenu: (x: number, y: number) => void;
}

export function ShapeAnnotation({
  annotation,
  dimension,
  zoom,
  selected,
  onSelect,
  onUpdate,
  onContextMenu,
}: ShapeAnnotationProps) {
  const didDragRef = useRef(false);

  const pageW = dimension.width * zoom;
  const pageH = dimension.height * zoom;

  const px1 = annotation.x1 * pageW;
  const py1 = annotation.y1 * pageH;
  const px2 = annotation.x2 * pageW;
  const py2 = annotation.y2 * pageH;

  const minX = Math.min(px1, px2);
  const minY = Math.min(py1, py2);
  const maxX = Math.max(px1, px2);
  const maxY = Math.max(py1, py2);
  const bboxW = maxX - minX;
  const bboxH = maxY - minY;

  const pad = SHAPE_PADDING;
  const isLine = annotation.shape === "line" || annotation.shape === "arrow";

  const svgX1 = px1 - minX + pad;
  const svgY1 = py1 - minY + pad;
  const svgX2 = px2 - minX + pad;
  const svgY2 = py2 - minY + pad;

  // Shape drag moves all four endpoints
  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (
        (e.target as HTMLElement).classList.contains("highlight-resize-handle") ||
        (e.target as HTMLElement).classList.contains("shape-endpoint-handle")
      ) return;
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      didDragRef.current = false;

      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const startX1 = annotation.x1;
      const startY1 = annotation.y1;
      const startX2 = annotation.x2;
      const startY2 = annotation.y2;

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startMouseX;
        const dy = ev.clientY - startMouseY;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) didDragRef.current = true;
        const dxNorm = dx / pageW;
        const dyNorm = dy / pageH;
        onUpdate({
          x1: startX1 + dxNorm,
          y1: startY1 + dyNorm,
          x2: startX2 + dxNorm,
          y2: startY2 + dyNorm,
        });
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [annotation.x1, annotation.y1, annotation.x2, annotation.y2, pageW, pageH, onUpdate, onSelect]
  );

  const handleCornerResize = useCallback(
    (e: React.MouseEvent, corner: string) => {
      e.preventDefault();
      e.stopPropagation();

      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const startX1 = annotation.x1;
      const startY1 = annotation.y1;
      const startX2 = annotation.x2;
      const startY2 = annotation.y2;

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = (ev.clientX - startMouseX) / pageW;
        const dy = (ev.clientY - startMouseY) / pageH;

        let newX1 = startX1, newY1 = startY1, newX2 = startX2, newY2 = startY2;
        if (corner.includes("l")) newX1 = startX1 + dx;
        if (corner.includes("r")) newX2 = startX2 + dx;
        if (corner.includes("t")) newY1 = startY1 + dy;
        if (corner.includes("b")) newY2 = startY2 + dy;
        onUpdate({ x1: newX1, y1: newY1, x2: newX2, y2: newY2 });
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [annotation.x1, annotation.y1, annotation.x2, annotation.y2, pageW, pageH, onUpdate]
  );

  const handleEndpointDrag = useCallback(
    (e: React.MouseEvent, endpoint: 1 | 2) => {
      e.preventDefault();
      e.stopPropagation();

      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const startVal = endpoint === 1
        ? { x: annotation.x1, y: annotation.y1 }
        : { x: annotation.x2, y: annotation.y2 };

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = (ev.clientX - startMouseX) / pageW;
        const dy = (ev.clientY - startMouseY) / pageH;
        if (endpoint === 1) {
          onUpdate({ x1: startVal.x + dx, y1: startVal.y + dy });
        } else {
          onUpdate({ x2: startVal.x + dx, y2: startVal.y + dy });
        }
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [annotation.x1, annotation.y1, annotation.x2, annotation.y2, pageW, pageH, onUpdate]
  );

  const renderShape = () => {
    const sw = annotation.strokeWidth;
    const color = annotation.color;

    if (annotation.shape === "rectangle") {
      const rx = Math.min(svgX1, svgX2);
      const ry = Math.min(svgY1, svgY2);
      const rw = Math.abs(svgX2 - svgX1);
      const rh = Math.abs(svgY2 - svgY1);
      return (
        <rect
          x={rx}
          y={ry}
          width={rw}
          height={rh}
          fill="none"
          stroke={color}
          strokeWidth={sw}
        />
      );
    }

    if (annotation.shape === "ellipse") {
      const cx = (svgX1 + svgX2) / 2;
      const cy = (svgY1 + svgY2) / 2;
      const rx = Math.abs(svgX2 - svgX1) / 2;
      const ry = Math.abs(svgY2 - svgY1) / 2;
      return (
        <ellipse
          cx={cx}
          cy={cy}
          rx={rx}
          ry={ry}
          fill="none"
          stroke={color}
          strokeWidth={sw}
        />
      );
    }

    return (
      <>
        <defs>
          <marker
            id={`arrow-${annotation.id}`}
            markerWidth="10"
            markerHeight="8"
            refX="9"
            refY="4"
            orient="auto"
            markerUnits="strokeWidth"
          >
            <path d="M0,0 L10,4 L0,8 L2,4 Z" fill={color} />
          </marker>
        </defs>
        <line
          x1={svgX1}
          y1={svgY1}
          x2={svgX2}
          y2={svgY2}
          stroke={color}
          strokeWidth={sw}
          strokeLinecap="round"
          markerEnd={annotation.shape === "arrow" ? `url(#arrow-${annotation.id})` : undefined}
        />
      </>
    );
  };

  return (
    <div
      className={`shape-annotation${selected ? " annotation-selected" : ""}`}
      style={{
        position: "absolute",
        left: minX - pad,
        top: minY - pad,
        width: bboxW + pad * 2,
        height: bboxH + pad * 2,
        pointerEvents: "auto",
        cursor: "move",
      }}
      onMouseDown={handleDragStart}
      onClick={(e) => {
        e.stopPropagation();
        if (!didDragRef.current) onSelect();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onContextMenu(e.clientX, e.clientY);
      }}
    >
      <svg
        width={bboxW + pad * 2}
        height={bboxH + pad * 2}
        style={{ position: "absolute", top: 0, left: 0, overflow: "visible" }}
      >
        {renderShape()}
      </svg>

      {selected && !isLine &&
        ["tl", "tr", "bl", "br"].map((corner) => (
          <div
            key={corner}
            className={`highlight-resize-handle highlight-resize-${corner}`}
            onMouseDown={(e) => handleCornerResize(e, corner)}
          />
        ))}

      {selected && isLine && (
        <>
          <div
            className="shape-endpoint-handle"
            style={{
              left: svgX1 - 5,
              top: svgY1 - 5,
            }}
            onMouseDown={(e) => handleEndpointDrag(e, 1)}
          />
          <div
            className="shape-endpoint-handle"
            style={{
              left: svgX2 - 5,
              top: svgY2 - 5,
            }}
            onMouseDown={(e) => handleEndpointDrag(e, 2)}
          />
        </>
      )}
    </div>
  );
}
