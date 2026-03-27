import { useEffect } from "react";
import { createPortal } from "react-dom";

interface PageContextMenuProps {
  x: number;
  y: number;
  pageNumber: number;
  isBookmarked: boolean;
  onToggleBookmark: () => void;
  onClose: () => void;
}

export function PageContextMenu({
  x,
  y,
  isBookmarked,
  onToggleBookmark,
  onClose,
}: PageContextMenuProps) {
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

  return createPortal(
    <div
      className="thumbnail-context-menu"
      style={{ position: "fixed", left: x, top: y }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <button
        className="context-menu-item"
        onClick={() => {
          onToggleBookmark();
          onClose();
        }}
      >
        {isBookmarked ? "Remove Bookmark" : "Add Bookmark"}
      </button>
    </div>,
    document.body
  );
}
