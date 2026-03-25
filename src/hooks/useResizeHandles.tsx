import { useCallback } from "react";
import type { PageDimension } from "../types";

interface UseResizeHandlesOptions {
  rect: { x: number; y: number; width: number; height: number };
  /** Pixel-space width/height (already multiplied by zoom). */
  pixelSize: { width: number; height: number };
  dimension: PageDimension;
  zoom: number;
  onUpdate: (updates: Record<string, unknown>) => void;
  minWidth?: number;
  minHeight?: number;
  /** Compute additional fields after resize (e.g., scaling ink path points). */
  computeExtraUpdates?: (x: number, y: number, w: number, h: number) => Record<string, unknown>;
  handleClassName?: string;
}

const CORNERS = ["tl", "tr", "bl", "br"] as const;

export function useResizeHandles({
  rect,
  pixelSize,
  dimension,
  zoom,
  onUpdate,
  minWidth = 10,
  minHeight = 10,
  computeExtraUpdates,
  handleClassName = "highlight-resize-handle",
}: UseResizeHandlesOptions) {
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, corner: string) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      const startW = pixelSize.width;
      const startH = pixelSize.height;
      const pageW = dimension.width * zoom;
      const pageH = dimension.height * zoom;

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;

        let newW = startW;
        let newH = startH;

        if (corner.includes("r")) newW = Math.max(minWidth, startW + dx);
        if (corner.includes("l")) newW = Math.max(minWidth, startW - dx);
        if (corner.includes("b")) newH = Math.max(minHeight, startH + dy);
        if (corner.includes("t")) newH = Math.max(minHeight, startH - dy);

        const normW = newW / pageW;
        const normH = newH / pageH;

        let normX = rect.x;
        let normY = rect.y;
        if (corner.includes("l")) normX = rect.x + rect.width - normW;
        if (corner.includes("t")) normY = rect.y + rect.height - normH;

        const updates: Record<string, unknown> = {
          x: normX,
          y: normY,
          width: normW,
          height: normH,
          ...(computeExtraUpdates?.(normX, normY, normW, normH)),
        };
        onUpdate(updates);
      };

      const handleMouseUp = () => {
        window.removeEventListener("mousemove", handleMouseMove);
        window.removeEventListener("mouseup", handleMouseUp);
      };

      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
    },
    [rect, pixelSize, dimension, zoom, onUpdate, minWidth, minHeight, computeExtraUpdates]
  );

  const ResizeHandles = () => (
    <>
      {CORNERS.map((corner) => (
        <div
          key={corner}
          className={`${handleClassName} ${handleClassName.split(" ")[0]}-${corner}`}
          onMouseDown={(e) => handleResizeStart(e, corner)}
        />
      ))}
    </>
  );

  return { handleResizeStart, ResizeHandles };
}
