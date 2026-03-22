import type { HighlightAnnotation, PageDimension } from "../types";

interface HighlightRectProps {
  annotation: HighlightAnnotation;
  dimension: PageDimension;
  zoom: number;
  onClick: () => void;
  onDelete: () => void;
}

export function HighlightRect({ annotation, dimension, zoom, onDelete }: HighlightRectProps) {
  const left = annotation.x * dimension.width * zoom;
  const top = annotation.y * dimension.height * zoom;
  const width = annotation.width * dimension.width * zoom;
  const height = annotation.height * dimension.height * zoom;

  return (
    <div
      className="highlight-annotation"
      style={{
        position: "absolute",
        left,
        top,
        width,
        height,
        backgroundColor: annotation.color,
        mixBlendMode: "multiply",
        opacity: 0.35,
        pointerEvents: "auto",
        cursor: "pointer",
      }}
      title="Right-click to delete"
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onDelete();
      }}
    />
  );
}
