import type { TextMarkupAnnotation, PageDimension } from "../types";
import { MIN_RESIZE_DIM } from "../constants";
import { useDragToMove } from "../hooks/useDragToMove";
import { useResizeHandles } from "../hooks/useResizeHandles";

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
      {selected && <ResizeHandles />}
    </div>
  );
}
