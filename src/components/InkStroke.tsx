import { useCallback, useRef } from "react";
import type { InkAnnotation, PageDimension } from "../types";
import { MIN_RESIZE_DIM, INK_STROKE_PADDING } from "../constants";
import { useDragToMove } from "../hooks/useDragToMove";

interface InkStrokeProps {
  annotation: InkAnnotation;
  dimension: PageDimension;
  zoom: number;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<InkAnnotation>) => void;
  onContextMenu: (x: number, y: number) => void;
}

export function InkStroke({
  annotation,
  dimension,
  zoom,
  selected,
  onSelect,
  onUpdate,
  onContextMenu,
}: InkStrokeProps) {
  const pageW = dimension.width * zoom;
  const pageH = dimension.height * zoom;

  const left = annotation.x * pageW;
  const top = annotation.y * pageH;
  const width = annotation.width * pageW;
  const height = annotation.height * pageH;

  // Memoize start paths for drag translation
  const pathsRef = useRef(annotation.paths);
  pathsRef.current = annotation.paths;

  const computeExtraUpdates = useCallback(
    (dxNorm: number, dyNorm: number) => {
      const newPaths = pathsRef.current.map((stroke) =>
        stroke.map((pt) => ({ x: pt.x + dxNorm, y: pt.y + dyNorm }))
      );
      return { paths: newPaths };
    },
    []
  );

  const { didDragRef, handleDragStart } = useDragToMove({
    position: { x: annotation.x, y: annotation.y },
    dimension,
    zoom,
    onSelect,
    onUpdate: onUpdate as (updates: Record<string, unknown>) => void,
    computeExtraUpdates,
    guardSelector: "highlight-resize-handle",
  });

  // Ink resize scales all points relative to bounding box
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, corner: string) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const startW = width;
      const startH = height;
      const startAnnX = annotation.x;
      const startAnnY = annotation.y;
      const startAnnW = annotation.width;
      const startAnnH = annotation.height;
      const startPaths = annotation.paths;

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        let newW = startW;
        let newH = startH;

        if (corner.includes("r")) newW = Math.max(MIN_RESIZE_DIM, startW + dx);
        if (corner.includes("l")) newW = Math.max(MIN_RESIZE_DIM, startW - dx);
        if (corner.includes("b")) newH = Math.max(MIN_RESIZE_DIM, startH + dy);
        if (corner.includes("t")) newH = Math.max(MIN_RESIZE_DIM, startH - dy);

        const normW = newW / pageW;
        const normH = newH / pageH;

        let normX = startAnnX;
        let normY = startAnnY;
        if (corner.includes("l")) normX = startAnnX + startAnnW - normW;
        if (corner.includes("t")) normY = startAnnY + startAnnH - normH;

        const scaleX = normW / startAnnW;
        const scaleY = normH / startAnnH;
        const newPaths = startPaths.map((stroke) =>
          stroke.map((pt) => ({
            x: normX + (pt.x - startAnnX) * scaleX,
            y: normY + (pt.y - startAnnY) * scaleY,
          }))
        );

        onUpdate({ x: normX, y: normY, width: normW, height: normH, paths: newPaths });
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [annotation, width, height, pageW, pageH, onUpdate]
  );

  // Build SVG path strings
  const svgPaths = annotation.paths.map((stroke) => {
    if (stroke.length < 2) return "";
    const points = stroke.map((pt) => ({
      x: pt.x * pageW - left,
      y: pt.y * pageH - top,
    }));
    return (
      `M ${points[0].x} ${points[0].y}` +
      points.slice(1).map((pt) => ` L ${pt.x} ${pt.y}`).join("")
    );
  });

  const pad = INK_STROKE_PADDING;

  return (
    <div
      className={`ink-annotation${selected ? " annotation-selected" : ""}`}
      style={{
        position: "absolute",
        left: left - pad,
        top: top - pad,
        width: width + pad * 2,
        height: height + pad * 2,
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
        width={width + pad * 2}
        height={height + pad * 2}
        style={{ position: "absolute", top: 0, left: 0 }}
      >
        {svgPaths.map((d, i) =>
          d ? (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={annotation.color}
              strokeWidth={annotation.strokeWidth}
              strokeLinecap="round"
              strokeLinejoin="round"
              transform={`translate(${pad}, ${pad})`}
            />
          ) : null
        )}
      </svg>
      {selected &&
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
