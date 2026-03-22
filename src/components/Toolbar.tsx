import { useState } from "react";
import type { AnnotationTool } from "../types";

const isMac = navigator.platform.toUpperCase().includes("MAC");
const mod = isMac ? "Cmd" : "Ctrl";

interface ToolbarProps {
  fileName: string | null;
  currentPage: number;
  totalPages: number;
  zoom: number;
  loading: boolean;
  sidebarOpen: boolean;
  activeTool: AnnotationTool;
  hasUnsavedChanges: boolean;
  viewMode: "scroll" | "gallery";
  onOpen: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onZoomChange: (zoom: number) => void;
  onFitWidth: () => void;
  onFitPage: () => void;
  onToggleSidebar: () => void;
  onToggleGallery: () => void;
  onToolChange: (tool: AnnotationTool) => void;
  onSave: () => void;
  onPrint: () => void;
}

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 5];
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 100;

export function Toolbar({
  fileName,
  currentPage,
  totalPages,
  zoom,
  loading,
  sidebarOpen,
  activeTool,
  hasUnsavedChanges,
  viewMode,
  onOpen,
  onPrevPage,
  onNextPage,
  onZoomChange,
  onFitWidth,
  onFitPage,
  onToggleSidebar,
  onToggleGallery,
  onToolChange,
  onSave,
  onPrint,
}: ToolbarProps) {
  const [zoomInput, setZoomInput] = useState<string | null>(null);

  const zoomIn = () => {
    const next = ZOOM_STEPS.find((s) => s > zoom + 0.001);
    if (next) onZoomChange(next);
  };
  const zoomOut = () => {
    const prev = [...ZOOM_STEPS].reverse().find((s) => s < zoom - 0.001);
    if (prev) onZoomChange(prev);
  };

  const commitZoomInput = () => {
    if (zoomInput === null) return;
    const num = parseFloat(zoomInput);
    if (!isNaN(num) && num > 0) {
      const clamped = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, num / 100));
      onZoomChange(clamped);
    }
    setZoomInput(null);
  };

  return (
    <div className="toolbar">
      <button onClick={onOpen} disabled={loading}>
        {loading ? "Opening…" : "Open PDF"}
      </button>

      {fileName && <span className="file-name">{fileName}</span>}

      {totalPages > 0 && (
        <>
          <div className="toolbar-divider" />
          <button
            onClick={onToggleSidebar}
            className={sidebarOpen && viewMode === "scroll" ? "tool-active" : ""}
            disabled={viewMode === "gallery"}
            data-tooltip="Thumbnails"
          >
            ☰
          </button>
          <button
            onClick={onToggleGallery}
            className={viewMode === "gallery" ? "tool-active" : ""}
            data-tooltip="Gallery View"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="1" y="1" width="6" height="6" rx="1" />
              <rect x="9" y="1" width="6" height="6" rx="1" />
              <rect x="1" y="9" width="6" height="6" rx="1" />
              <rect x="9" y="9" width="6" height="6" rx="1" />
            </svg>
          </button>

          <div className="toolbar-divider" />
          <button onClick={onPrevPage} disabled={currentPage <= 1}>
            ‹
          </button>
          <span className="page-info">
            {currentPage} / {totalPages}
          </span>
          <button onClick={onNextPage} disabled={currentPage >= totalPages}>
            ›
          </button>

          <div className="toolbar-divider" />
          <button onClick={zoomOut} disabled={zoom <= ZOOM_STEPS[0]}>
            −
          </button>
          <input
            className="zoom-input"
            value={zoomInput !== null ? zoomInput : `${Math.round(zoom * 100)}%`}
            onChange={(e) => setZoomInput(e.target.value)}
            onFocus={(e) => {
              setZoomInput(String(Math.round(zoom * 100)));
              // Select all text on focus so you can just type a new value
              requestAnimationFrame(() => e.target.select());
            }}
            onBlur={commitZoomInput}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                commitZoomInput();
                (e.target as HTMLInputElement).blur();
              }
              if (e.key === "Escape") {
                setZoomInput(null);
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          <button onClick={zoomIn} disabled={zoom >= ZOOM_STEPS[ZOOM_STEPS.length - 1]}>
            +
          </button>
          <button onClick={onFitWidth} data-tooltip="Fit Width">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 4V12H15V4H1Z" />
              <path d="M4 8H1M15 8H12" />
              <path d="M3 6L1 8L3 10" />
              <path d="M13 6L15 8L13 10" />
            </svg>
          </button>
          <button onClick={onFitPage} data-tooltip="Fit Page">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="1" width="10" height="14" rx="1" />
              <path d="M6 5L3 8L6 11" />
              <path d="M10 5L13 8L10 11" />
              <path d="M3 8H6M13 8H10" />
            </svg>
          </button>

          <div className="toolbar-divider" />
          <button
            onClick={() => onToolChange(activeTool === "highlight" ? "none" : "highlight")}
            className={activeTool === "highlight" ? "tool-active" : ""}
            data-tooltip="Highlight"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.5 1.5L14.5 5.5L6 14H2V10L10.5 1.5Z" />
              <path d="M8.5 3.5L12.5 7.5" />
            </svg>
          </button>
          <button
            onClick={() => onToolChange(activeTool === "sticky-note" ? "none" : "sticky-note")}
            className={activeTool === "sticky-note" ? "tool-active" : ""}
            data-tooltip="Sticky Note"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M2 2h12v8l-4 4H2V2Z" />
              <path d="M10 10v4" />
            </svg>
          </button>

          <div className="toolbar-divider" />
          <button onClick={onSave} disabled={!hasUnsavedChanges}>
            Save
          </button>
          <button onClick={onPrint} data-tooltip={`Print (${mod}+P)`}>
            Print
          </button>
        </>
      )}
    </div>
  );
}
