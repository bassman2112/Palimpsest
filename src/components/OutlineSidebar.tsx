import { useState, useCallback, useRef } from "react";
import type { OutlineItem } from "../lib/pdf/types";
import type { CustomBookmark } from "../hooks/useCustomBookmarks";

interface OutlineSidebarProps {
  outline: OutlineItem[];
  currentPage: number;
  onPageClick: (page: number) => void;
  customBookmarks?: CustomBookmark[];
  onRemoveBookmark?: (id: string) => void;
  onUpdateBookmarkLabel?: (id: string, label: string) => void;
}

function OutlineNode({
  item,
  depth,
  currentPage,
  onPageClick,
}: {
  item: OutlineItem;
  depth: number;
  currentPage: number;
  onPageClick: (page: number) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const hasChildren = item.children.length > 0;
  const isCurrent = item.pageNumber === currentPage;

  const handleClick = useCallback(() => {
    if (item.pageNumber != null) {
      onPageClick(item.pageNumber);
    }
  }, [item.pageNumber, onPageClick]);

  const handleToggle = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setExpanded((v) => !v);
    },
    []
  );

  return (
    <li>
      <div
        className={`outline-item${isCurrent ? " outline-item-active" : ""}`}
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={handleClick}
        title={item.title}
      >
        {hasChildren ? (
          <span className="outline-chevron" onClick={handleToggle}>
            {expanded ? "\u25BE" : "\u25B8"}
          </span>
        ) : (
          <span className="outline-chevron-placeholder" />
        )}
        <span className="outline-title">{item.title}</span>
        {item.pageNumber != null && (
          <span className="outline-page-num">{item.pageNumber}</span>
        )}
      </div>
      {hasChildren && expanded && (
        <ul className="outline-children">
          {item.children.map((child, i) => (
            <OutlineNode
              key={i}
              item={child}
              depth={depth + 1}
              currentPage={currentPage}
              onPageClick={onPageClick}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function BookmarkItem({
  bookmark,
  isCurrent,
  onPageClick,
  onRemove,
  onUpdateLabel,
}: {
  bookmark: CustomBookmark;
  isCurrent: boolean;
  onPageClick: (page: number) => void;
  onRemove?: (id: string) => void;
  onUpdateLabel?: (id: string, label: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDoubleClick = useCallback(() => {
    if (onUpdateLabel) {
      setEditing(true);
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [onUpdateLabel]);

  const commitEdit = useCallback(() => {
    setEditing(false);
    const value = inputRef.current?.value.trim();
    if (value && value !== bookmark.label) {
      onUpdateLabel?.(bookmark.id, value);
    }
  }, [bookmark.id, bookmark.label, onUpdateLabel]);

  return (
    <div
      className={`bookmark-item${isCurrent ? " outline-item-active" : ""}`}
      onClick={() => onPageClick(bookmark.pageNumber)}
      title={bookmark.label}
    >
      <svg className="bookmark-item-icon" width="12" height="14" viewBox="0 0 12 14" fill="currentColor" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 1.5A.5.5 0 0 1 1.5 1h9a.5.5 0 0 1 .5.5V13l-5-3-5 3V1.5Z" />
      </svg>
      {editing ? (
        <input
          ref={inputRef}
          className="bookmark-label-input"
          defaultValue={bookmark.label}
          onBlur={commitEdit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commitEdit();
            if (e.key === "Escape") setEditing(false);
          }}
          onClick={(e) => e.stopPropagation()}
        />
      ) : (
        <span className="outline-title" onDoubleClick={handleDoubleClick}>
          {bookmark.label}
        </span>
      )}
      <span className="outline-page-num">{bookmark.pageNumber}</span>
      {onRemove && (
        <button
          className="bookmark-delete-btn"
          onClick={(e) => {
            e.stopPropagation();
            onRemove(bookmark.id);
          }}
          title="Remove bookmark"
        >
          ✕
        </button>
      )}
    </div>
  );
}

export function OutlineSidebar({
  outline,
  currentPage,
  onPageClick,
  customBookmarks,
  onRemoveBookmark,
  onUpdateBookmarkLabel,
}: OutlineSidebarProps) {
  const hasBookmarks = customBookmarks && customBookmarks.length > 0;
  const hasOutline = outline.length > 0;
  const showHeaders = hasBookmarks && hasOutline;

  if (!hasBookmarks && !hasOutline) {
    return (
      <div className="outline-sidebar">
        <div className="outline-empty">No bookmarks or outline</div>
      </div>
    );
  }

  return (
    <div className="outline-sidebar">
      {hasBookmarks && (
        <>
          {showHeaders && <div className="outline-section-header">My Bookmarks</div>}
          <div className="bookmark-list">
            {customBookmarks.map((b) => (
              <BookmarkItem
                key={b.id}
                bookmark={b}
                isCurrent={b.pageNumber === currentPage}
                onPageClick={onPageClick}
                onRemove={onRemoveBookmark}
                onUpdateLabel={onUpdateBookmarkLabel}
              />
            ))}
          </div>
        </>
      )}
      {hasOutline && (
        <>
          {showHeaders && <div className="outline-section-header">Document Outline</div>}
          <ul className="outline-list">
            {outline.map((item, i) => (
              <OutlineNode
                key={i}
                item={item}
                depth={0}
                currentPage={currentPage}
                onPageClick={onPageClick}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
