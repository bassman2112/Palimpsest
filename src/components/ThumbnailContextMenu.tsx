import { useEffect } from "react";
import { createPortal } from "react-dom";

interface ThumbnailContextMenuProps {
  x: number;
  y: number;
  pageNumber: number;
  totalPages: number;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onReorder: () => void;
  onRotateClockwise?: () => void;
  onRotateCounterclockwise?: () => void;
  onExtractPages?: () => void;
  onSplitAfter?: () => void;
  onInsertBlankPage?: () => void;
  onInsertImagePage?: () => void;
  extractLabel?: string;
  onDelete: () => void;
  onClose: () => void;
}

export function ThumbnailContextMenu({
  x,
  y,
  pageNumber,
  totalPages,
  onMoveUp,
  onMoveDown,
  onReorder,
  onRotateClockwise,
  onRotateCounterclockwise,
  onExtractPages,
  onSplitAfter,
  onInsertBlankPage,
  onInsertImagePage,
  extractLabel,
  onDelete,
  onClose,
}: ThumbnailContextMenuProps) {
  useEffect(() => {
    const handleMouseDown = () => {
      setTimeout(onClose, 0);
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const handleScroll = () => onClose();

    window.addEventListener("mousedown", handleMouseDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("mousedown", handleMouseDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [onClose]);

  const isFirst = pageNumber === 1;
  const isLast = pageNumber === totalPages;
  const onlyPage = totalPages <= 1;

  return createPortal(
    <div
      className="thumbnail-context-menu"
      style={{ position: "fixed", left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        className="context-menu-item"
        disabled={isFirst}
        onClick={() => { onMoveUp(); onClose(); }}
      >
        Move Up
      </button>
      <button
        className="context-menu-item"
        disabled={isLast}
        onClick={() => { onMoveDown(); onClose(); }}
      >
        Move Down
      </button>
      <button
        className="context-menu-item"
        disabled={onlyPage}
        onClick={() => { onReorder(); onClose(); }}
      >
        Reorder
      </button>
      <div className="context-menu-separator" />
      {onRotateClockwise && (
        <button
          className="context-menu-item"
          onClick={() => { onRotateClockwise(); onClose(); }}
        >
          Rotate Right
        </button>
      )}
      {onRotateCounterclockwise && (
        <button
          className="context-menu-item"
          onClick={() => { onRotateCounterclockwise(); onClose(); }}
        >
          Rotate Left
        </button>
      )}
      {(onRotateClockwise || onRotateCounterclockwise) && (
        <div className="context-menu-separator" />
      )}
      {onExtractPages && (
        <button
          className="context-menu-item"
          onClick={() => { onExtractPages(); onClose(); }}
        >
          {extractLabel ?? "Extract Page"}
        </button>
      )}
      {onSplitAfter && (
        <button
          className="context-menu-item"
          disabled={isLast}
          onClick={() => { onSplitAfter(); onClose(); }}
        >
          Split After This Page
        </button>
      )}
      {(onExtractPages || onSplitAfter) && (
        <div className="context-menu-separator" />
      )}
      {onInsertBlankPage && (
        <button
          className="context-menu-item"
          onClick={() => { onInsertBlankPage(); onClose(); }}
        >
          Insert Blank Page
        </button>
      )}
      {onInsertImagePage && (
        <button
          className="context-menu-item"
          onClick={() => { onInsertImagePage(); onClose(); }}
        >
          Insert Image as Page
        </button>
      )}
      {(onInsertBlankPage || onInsertImagePage) && (
        <div className="context-menu-separator" />
      )}
      <button
        className="context-menu-item context-menu-item-danger"
        disabled={onlyPage}
        onClick={() => { onDelete(); onClose(); }}
      >
        Delete Page
      </button>
    </div>,
    document.body
  );
}
