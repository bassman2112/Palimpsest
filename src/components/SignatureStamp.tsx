import { useRef, useCallback } from "react";
import type { SignatureAnnotation, PageDimension } from "../types";
import { MIN_SIGNATURE_WIDTH, MIN_SIGNATURE_HEIGHT } from "../constants";
import { useDragToMove } from "../hooks/useDragToMove";

interface SignatureStampProps {
  annotation: SignatureAnnotation;
  dimension: PageDimension;
  zoom: number;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<SignatureAnnotation>) => void;
  onContextMenu: (x: number, y: number) => void;
}

export function SignatureStamp({
  annotation,
  dimension,
  zoom,
  selected,
  onSelect,
  onUpdate,
  onContextMenu,
}: SignatureStampProps) {
  const aspectRatio = useRef(annotation.width / annotation.height);

  const left = annotation.x * dimension.width * zoom;
  const top = annotation.y * dimension.height * zoom;
  const width = annotation.width * dimension.width * zoom;
  const height = annotation.height * dimension.height * zoom;

  const { didDragRef, handleDragStart } = useDragToMove({
    position: { x: annotation.x, y: annotation.y },
    dimension,
    zoom,
    onSelect,
    onUpdate: onUpdate as (updates: Record<string, unknown>) => void,
    guardSelector: "signature-resize-handle",
  });

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, corner: string) => {
      e.preventDefault();
      e.stopPropagation();
      aspectRatio.current = annotation.width / annotation.height;

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - e.clientX;
        const dy = ev.clientY - e.clientY;
        const pageW = dimension.width * zoom;
        const pageH = dimension.height * zoom;

        let newW = width;
        let newH = height;

        if (corner.includes("r")) newW = Math.max(MIN_SIGNATURE_WIDTH, width + dx);
        if (corner.includes("l")) newW = Math.max(MIN_SIGNATURE_WIDTH, width - dx);
        if (corner.includes("b")) newH = Math.max(MIN_SIGNATURE_HEIGHT, height + dy);
        if (corner.includes("t")) newH = Math.max(MIN_SIGNATURE_HEIGHT, height - dy);

        // Proportional resize by default, free with Shift
        if (!ev.shiftKey) {
          const scale = Math.max(newW / width, newH / height);
          newW = width * scale;
          newH = height * scale;
        }

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

  return (
    <div
      className={`signature-stamp${selected ? " annotation-selected" : ""}`}
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
      <img
        src={annotation.imageData}
        alt="Signature"
        draggable={false}
        style={{
          width: "100%",
          height: "100%",
          objectFit: "fill",
          display: "block",
        }}
      />
      {["tl", "tr", "bl", "br"].map((corner) => (
        <div
          key={corner}
          className={`signature-resize-handle signature-resize-${corner}`}
          onMouseDown={(e) => handleResizeStart(e, corner)}
        />
      ))}
    </div>
  );
}
