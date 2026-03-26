import { useEffect, useRef, useState } from "react";
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
  isMerging?: boolean;
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
  onSaveAs: () => void;
  onSaveLocked?: () => void;
  onPrint: () => void;
  onAddDocument?: () => void;
  onSaveMerged?: () => void;
  onExitMerge?: () => void;
  onSignatureClick?: () => void;
  onGoToPage?: (page: number) => void;
  onApplyRedactions?: () => void;
  hasRedactions?: boolean;
  onToggleBookmarks?: () => void;
  bookmarksOpen?: boolean;
  onExportPages?: () => void;
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
  isMerging,
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
  onSaveAs,
  onSaveLocked,
  onPrint,
  onAddDocument,
  onSaveMerged,
  onExitMerge,
  onSignatureClick,
  onGoToPage,
  onApplyRedactions,
  hasRedactions,
  onToggleBookmarks,
  bookmarksOpen,
  onExportPages,
}: ToolbarProps) {
  const [zoomInput, setZoomInput] = useState<string | null>(null);
  const [pageInput, setPageInput] = useState<string | null>(null);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const [moreToolsOpen, setMoreToolsOpen] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const moreToolsRef = useRef<HTMLDivElement>(null);

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

  const commitPageInput = () => {
    if (pageInput === null) return;
    const num = parseInt(pageInput, 10);
    if (!isNaN(num) && num >= 1 && num <= totalPages) {
      onGoToPage?.(num);
    }
    setPageInput(null);
  };

  // Close save menu on outside click
  useEffect(() => {
    if (!saveMenuOpen) return;
    function handleClick(e: MouseEvent) {
      if (saveMenuRef.current && !saveMenuRef.current.contains(e.target as Node)) {
        setSaveMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [saveMenuOpen]);

  // Close more tools dropdown on outside click
  useEffect(() => {
    if (!moreToolsOpen) return;
    function handleClick(e: MouseEvent) {
      if (moreToolsRef.current && !moreToolsRef.current.contains(e.target as Node)) {
        setMoreToolsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [moreToolsOpen]);


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
            disabled={viewMode === "gallery" || !!isMerging}
            data-tooltip="Thumbnails"
          >
            ☰
          </button>
          <button
            onClick={onToggleBookmarks}
            className={bookmarksOpen && viewMode === "scroll" ? "tool-active" : ""}
            disabled={viewMode === "gallery" || !!isMerging}
            data-tooltip="Bookmarks"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 2h8a1 1 0 0 1 1 1v11l-5-3-5 3V3a1 1 0 0 1 1-1Z" />
            </svg>
          </button>
          <button
            onClick={onToggleGallery}
            className={viewMode === "gallery" ? "tool-active" : ""}
            disabled={!!isMerging}
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
            <input
              className="page-input"
              value={pageInput !== null ? pageInput : String(currentPage)}
              onChange={(e) => setPageInput(e.target.value)}
              onFocus={(e) => {
                setPageInput(String(currentPage));
                requestAnimationFrame(() => e.target.select());
              }}
              onBlur={commitPageInput}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  commitPageInput();
                  (e.target as HTMLInputElement).blur();
                }
                if (e.key === "Escape") {
                  setPageInput(null);
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
            <span className="page-total">/ {totalPages}</span>
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

          {isMerging ? (
            <>
              <div className="toolbar-divider" />
              <button onClick={onAddDocument} data-tooltip="Add another PDF">
                Merge PDF
              </button>
              <button className="merge-save-btn" onClick={onSaveMerged} data-tooltip="Save merged PDF">
                Save Merged
              </button>
              <button onClick={onExitMerge} data-tooltip="Exit merge mode">
                Exit Merge
              </button>
            </>
          ) : (
            <>
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
                data-tooltip="Note"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 2h12v8l-4 4H2V2Z" />
                  <path d="M10 10v4" />
                </svg>
              </button>
              <button
                onClick={() => onToolChange(activeTool === "text" ? "none" : "text")}
                className={activeTool === "text" ? "tool-active" : ""}
                data-tooltip="Text"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3h10" />
                  <path d="M8 3v10" />
                  <path d="M5 13h6" />
                </svg>
              </button>
              <button
                onClick={() => {
                  if (activeTool === "signature") {
                    onToolChange("none");
                  } else {
                    onSignatureClick?.();
                  }
                }}
                className={activeTool === "signature" ? "tool-active" : ""}
                data-tooltip="Signature"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M2 13c2-3 4-8 6-8s2 5 4 5 2-2 2-2" />
                  <path d="M1 15h14" />
                </svg>
              </button>
              <div className="more-tools-group" ref={moreToolsRef}>
                <button
                  onClick={() => setMoreToolsOpen((o) => !o)}
                  className={["underline", "strikethrough", "ink", "redaction", "shape-rectangle", "shape-ellipse", "shape-line", "shape-arrow"].includes(activeTool) ? "tool-active" : ""}
                  data-tooltip="More Tools"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <circle cx="3" cy="8" r="1.5" />
                    <circle cx="8" cy="8" r="1.5" />
                    <circle cx="13" cy="8" r="1.5" />
                  </svg>
                </button>
                {moreToolsOpen && (
                  <div className="more-tools-dropdown">
                    <button
                      className={`more-tools-option${activeTool === "underline" ? " more-tools-active" : ""}`}
                      onClick={() => {
                        setMoreToolsOpen(false);
                        onToolChange(activeTool === "underline" ? "none" : "underline");
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 2v6a4 4 0 0 0 8 0V2" />
                        <path d="M2 14h12" />
                      </svg>
                      Underline
                    </button>
                    <button
                      className={`more-tools-option${activeTool === "strikethrough" ? " more-tools-active" : ""}`}
                      onClick={() => {
                        setMoreToolsOpen(false);
                        onToolChange(activeTool === "strikethrough" ? "none" : "strikethrough");
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 3h6a3 3 0 0 1 0 6H5" />
                        <path d="M2 8h12" />
                        <path d="M5 8v2a3 3 0 0 0 6 0" />
                      </svg>
                      Strikethrough
                    </button>
                    <button
                      className={`more-tools-option${activeTool === "ink" ? " more-tools-active" : ""}`}
                      onClick={() => {
                        setMoreToolsOpen(false);
                        onToolChange(activeTool === "ink" ? "none" : "ink");
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2 13.5c3-2 5-8 7-8s1.5 3 3 3c1 0 2-1.5 2-1.5" />
                      </svg>
                      Draw
                    </button>
                    <div className="more-tools-divider" />
                    <button
                      className={`more-tools-option${activeTool === "shape-rectangle" ? " more-tools-active" : ""}`}
                      onClick={() => {
                        setMoreToolsOpen(false);
                        onToolChange(activeTool === "shape-rectangle" ? "none" : "shape-rectangle");
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="3" width="12" height="10" rx="1" />
                      </svg>
                      Rectangle
                    </button>
                    <button
                      className={`more-tools-option${activeTool === "shape-ellipse" ? " more-tools-active" : ""}`}
                      onClick={() => {
                        setMoreToolsOpen(false);
                        onToolChange(activeTool === "shape-ellipse" ? "none" : "shape-ellipse");
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <ellipse cx="8" cy="8" rx="6" ry="5" />
                      </svg>
                      Ellipse
                    </button>
                    <button
                      className={`more-tools-option${activeTool === "shape-line" ? " more-tools-active" : ""}`}
                      onClick={() => {
                        setMoreToolsOpen(false);
                        onToolChange(activeTool === "shape-line" ? "none" : "shape-line");
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <line x1="2" y1="14" x2="14" y2="2" />
                      </svg>
                      Line
                    </button>
                    <button
                      className={`more-tools-option${activeTool === "shape-arrow" ? " more-tools-active" : ""}`}
                      onClick={() => {
                        setMoreToolsOpen(false);
                        onToolChange(activeTool === "shape-arrow" ? "none" : "shape-arrow");
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="2" y1="14" x2="14" y2="2" />
                        <polyline points="7,2 14,2 14,9" />
                      </svg>
                      Arrow
                    </button>
                    <div className="more-tools-divider" />
                    <button
                      className={`more-tools-option${activeTool === "redaction" ? " more-tools-active" : ""}`}
                      onClick={() => {
                        setMoreToolsOpen(false);
                        onToolChange(activeTool === "redaction" ? "none" : "redaction");
                      }}
                    >
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="4" width="12" height="8" rx="1" fill="rgba(220,38,38,0.3)" stroke="rgb(220,38,38)" />
                        <line x1="4" y1="8" x2="12" y2="8" stroke="rgb(220,38,38)" />
                      </svg>
                      Redact
                    </button>
                  </div>
                )}
              </div>

              <div className="toolbar-divider" />
              <div className="save-tool-group" ref={saveMenuRef}>
                <button onClick={onSave} disabled={!hasUnsavedChanges}>
                  Save
                </button>
                <button
                  className="save-dropdown-btn"
                  onClick={() => setSaveMenuOpen((o) => !o)}
                  data-tooltip="Save options"
                >
                  <svg width="8" height="6" viewBox="0 0 8 6" fill="currentColor">
                    <path d="M0 0l4 6 4-6z" />
                  </svg>
                </button>
                {saveMenuOpen && (
                  <div className="save-dropdown">
                    <button
                      className="save-dropdown-option"
                      onClick={() => {
                        setSaveMenuOpen(false);
                        onSaveAs();
                      }}
                    >
                      Save As… <span className="save-shortcut">{mod}+Shift+S</span>
                    </button>
                    {onSaveLocked && (
                      <button
                        className="save-dropdown-option"
                        onClick={() => {
                          setSaveMenuOpen(false);
                          onSaveLocked();
                        }}
                      >
                        Save As Locked…
                      </button>
                    )}
                    {onExportPages && (
                      <button
                        className="save-dropdown-option"
                        onClick={() => {
                          setSaveMenuOpen(false);
                          onExportPages();
                        }}
                      >
                        Export as Images…
                      </button>
                    )}
                    {onApplyRedactions && hasRedactions && (
                      <>
                        <div className="save-dropdown-divider" />
                        <button
                          className="save-dropdown-option"
                          onClick={() => {
                            setSaveMenuOpen(false);
                            onApplyRedactions();
                          }}
                          style={{ color: "rgb(220, 38, 38)" }}
                        >
                          Apply Redactions
                        </button>
                      </>
                    )}
                    {onAddDocument && (
                      <>
                        <div className="save-dropdown-divider" />
                        <button
                          className="save-dropdown-option"
                          onClick={() => {
                            setSaveMenuOpen(false);
                            onAddDocument();
                          }}
                        >
                          Merge PDF…
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
              <button onClick={onPrint} data-tooltip={`Print (${mod}+P)`}>
                Print
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}
