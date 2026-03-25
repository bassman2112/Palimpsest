import type { HighlightAnnotation, PageDimension } from "../types";
import { MIN_RESIZE_DIM } from "../constants";
import { useDragToMove } from "../hooks/useDragToMove";
import { useResizeHandles } from "../hooks/useResizeHandles";

interface HighlightRectProps {
  annotation: HighlightAnnotation;
  dimension: PageDimension;
  zoom: number;
  selected: boolean;
  onSelect: () => void;
  onUpdate: (updates: Partial<HighlightAnnotation>) => void;
  onContextMenu: (x: number, y: number) => void;
}

export function HighlightRect({
  annotation,
  dimension,
  zoom,
  selected,
  onSelect,
  onUpdate,
  onContextMenu,
}: HighlightRectProps) {
  const width = annotation.width * dimension.width * zoom;
  const height = annotation.height * dimension.height * zoom;

  const { didDragRef, handleDragStart } = useDragToMove({
    position: { x: annotation.x, y: annotation.y },
    dimension,
    zoom,
    onSelect,
    onUpdate: onUpdate as (updates: Record<string, unknown>) => void,
    guardSelector: "highlight-resize-handle",
  });

  const { ResizeHandles } = useResizeHandles({
    rect: { x: annotation.x, y: annotation.y, width: annotation.width, height: annotation.height },
    pixelSize: { width, height },
    dimension,
    zoom,
    onUpdate: onUpdate as (updates: Record<string, unknown>) => void,
    minWidth: MIN_RESIZE_DIM,
    minHeight: MIN_RESIZE_DIM,
  });

  return (
    <div
      className={`highlight-annotation${selected ? " annotation-selected" : ""}`}
      style={{
        position: "absolute",
        left: annotation.x * dimension.width * zoom,
        top: annotation.y * dimension.height * zoom,
        width,
        height,
        backgroundColor: annotation.color,
        mixBlendMode: "multiply",
        opacity: 0.35,
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
      {selected && <ResizeHandles />}
    </div>
  );
}
