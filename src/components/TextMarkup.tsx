import { useCallback, useRef } from "react";
import type { TextMarkupAnnotation, PageDimension } from "../types";

interface TextMarkupProps {
  annotation: TextMarkupAnnotation;
  dimension: PageDimension;
  zoom: number;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<TextMarkupAnnotation>) => void;
  onContextMenu: (x: number, y: number) => void;
}

export function TextMarkup({
  annotation,
  dimension,
  zoom,
  selected,
  onSelect,
  onUpdate,
  onContextMenu,
}: TextMarkupProps) {
  const didDragRef = useRef(false);

  const left = annotation.x * dimension.width * zoom;
  const top = annotation.y * dimension.height * zoom;
  const width = annotation.width * dimension.width * zoom;
  const height = annotation.height * dimension.height * zoom;

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
        const pageW = dimension.width * zoom;
        const pageH = dimension.height * zoom;

        let newW = startW;
        let newH = startH;

        if (corner.includes("r")) newW = Math.max(10, startW + dx);
        if (corner.includes("l")) newW = Math.max(10, startW - dx);
        if (corner.includes("b")) newH = Math.max(10, startH + dy);
        if (corner.includes("t")) newH = Math.max(10, startH - dy);

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
    [annotation, dimension, zoom, width, height, onUpdate]
  );

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if ((e.target as HTMLElement).classList.contains("highlight-resize-handle")) return;
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      didDragRef.current = false;

      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const startAnnX = annotation.x;
      const startAnnY = annotation.y;
      const pageW = dimension.width * zoom;
      const pageH = dimension.height * zoom;

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
    [annotation.x, annotation.y, dimension, zoom, onUpdate, onSelect]
  );

  const isStrikethrough = annotation.type === "strikethrough";
  const lineY = isStrikethrough ? top + height / 2 : top + height - 1;

  return (
    <div
      className={`text-markup-annotation${selected ? " annotation-selected" : ""}`}
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
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
      <div
        className="text-markup-line"
        style={{
          position: "absolute",
          left: 0,
          top: lineY - top,
          width: "100%",
          height: 2,
          backgroundColor: annotation.color,
        }}
      />
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
