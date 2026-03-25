import { useCallback, useRef } from "react";
import type { PageDimension } from "../types";
import { DRAG_THRESHOLD } from "../constants";

interface UseDragToMoveOptions {
  position: { x: number; y: number };
  dimension: PageDimension;
  zoom: number;
  onSelect: () => void;
  onUpdate: (updates: Record<string, unknown>) => void;
  /** Compute additional fields to include in the update (e.g., translating path points). */
  computeExtraUpdates?: (dxNorm: number, dyNorm: number) => Record<string, unknown>;
  /** CSS selector for elements that should NOT trigger a drag (e.g., resize handles). */
  guardSelector?: string;
  /** When true, drag is disabled (e.g., popover open, editing). */
  disabled?: boolean;
}

export function useDragToMove({
  position,
  dimension,
  zoom,
  onSelect,
  onUpdate,
  computeExtraUpdates,
  guardSelector,
  disabled,
}: UseDragToMoveOptions) {
  const didDragRef = useRef(false);

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      if (disabled) return;
      if (guardSelector && (e.target as HTMLElement).classList.contains(guardSelector)) return;
      e.preventDefault();
      e.stopPropagation();
      onSelect();
      didDragRef.current = false;

      const startMouseX = e.clientX;
      const startMouseY = e.clientY;
      const startX = position.x;
      const startY = position.y;
      const pageW = dimension.width * zoom;
      const pageH = dimension.height * zoom;

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startMouseX;
        const dy = ev.clientY - startMouseY;
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          didDragRef.current = true;
        }
        const dxNorm = dx / pageW;
        const dyNorm = dy / pageH;
        const updates: Record<string, unknown> = {
          x: startX + dxNorm,
          y: startY + dyNorm,
          ...(computeExtraUpdates?.(dxNorm, dyNorm)),
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
    [disabled, guardSelector, position.x, position.y, dimension, zoom, onSelect, onUpdate, computeExtraUpdates]
  );

  return { didDragRef, handleDragStart };
}
