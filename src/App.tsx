import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ask, save } from "@tauri-apps/plugin-dialog";
import "./services/pdfWorkerSetup";
import { useFileOpen } from "./hooks/useFileOpen";
import { usePdfDocument } from "./hooks/usePdfDocument";
import { useAnnotations } from "./hooks/useAnnotations";
import { useRecentFiles } from "./hooks/useRecentFiles";
import { useTextSearch } from "./hooks/useTextSearch";
import { Toolbar } from "./components/Toolbar";
import { PdfViewer } from "./components/PdfViewer";
import { ThumbnailSidebar } from "./components/ThumbnailSidebar";
import { PageGallery } from "./components/PageGallery";
import { SearchBar } from "./components/SearchBar";
import type { SearchBarHandle } from "./components/SearchBar";
import type { AnnotationTool, Annotation } from "./types";
import "./App.css";

interface AnnotationSaveData {
  annotation_type: string;
  page_number: number;
  x: number;
  y: number;
  width: number;
  height: number;
  text: string;
  color: [number, number, number];
}

function hexToColor(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return [r, g, b];
}

function toSaveData(annotations: Annotation[]): AnnotationSaveData[] {
  return annotations.map((a) => {
    if (a.type === "highlight") {
      return {
        annotation_type: "highlight",
        page_number: a.pageNumber,
        x: a.x,
        y: a.y,
        width: a.width,
        height: a.height,
        text: "",
        color: hexToColor(a.color),
      };
    }
    return {
      annotation_type: "sticky-note",
      page_number: a.pageNumber,
      x: a.x,
      y: a.y,
      width: 0,
      height: 0,
      text: a.text,
      color: hexToColor(a.color),
    };
  });
}

function App() {
  const { data, metadata, loading, error, openFile, openPath, initialAnnotations } = useFileOpen();
  const { pdfDoc, pageDimensions, error: docError } = usePdfDocument(data);
  const {
    annotations,
    hasChanges,
    add,
    update,
    remove,
    undo,
    redo,
    resetAnnotations,
    getPageAnnotations,
    markSaved,
  } = useAnnotations();
  const { recentFiles, addRecent } = useRecentFiles();
  const {
    matches: searchMatches,
    currentMatchIndex,
    currentMatch,
    searching,
    currentQuery: searchQuery,
    search,
    nextMatch,
    prevMatch,
    clearSearch,
  } = useTextSearch(pdfDoc);

  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTool, setActiveTool] = useState<AnnotationTool>("none");
  const [searchOpen, setSearchOpen] = useState(false);
  const [viewMode, setViewMode] = useState<"scroll" | "gallery">("scroll");

  const scrollToPageRef = useRef<((page: number) => void) | null>(null);
  const viewerContainerRef = useRef<HTMLDivElement | null>(null);
  const searchBarRef = useRef<SearchBarHandle>(null);
  const pageUndoStackRef = useRef<{ from: number; to: number }[]>([]);

  const fileName = metadata?.path.split(/[\\/]/).pop() ?? null;
  const totalPages = pageDimensions.length;

  // Load initial annotations when a new file is opened
  useEffect(() => {
    resetAnnotations(initialAnnotations);
    setCurrentPage(1);
  }, [initialAnnotations, resetAnnotations]);

  // Clear page undo stack when a different file is opened
  const prevPathRef = useRef(metadata?.path);
  useEffect(() => {
    if (metadata?.path !== prevPathRef.current) {
      // Only clear when the actual file path changes, not on reload after reorder
      const prevPath = prevPathRef.current;
      prevPathRef.current = metadata?.path;
      if (prevPath && metadata?.path && prevPath !== metadata.path) {
        pageUndoStackRef.current = [];
      }
    }
  }, [metadata?.path]);

  // Track opened file in recents
  useEffect(() => {
    if (metadata?.path) {
      addRecent(metadata.path);
    }
  }, [metadata?.path, addRecent]);

  // Sync recent files to native menu
  useEffect(() => {
    invoke("update_recent_files", {
      paths: recentFiles.map((f) => f.path),
    }).catch(() => {});
  }, [recentFiles]);

  // Scroll to the page of the current search match
  useEffect(() => {
    if (currentMatch) {
      scrollToPageRef.current?.(currentMatch.pageNumber);
    }
  }, [currentMatch]);

  const handleCloseSearch = useCallback(() => {
    setSearchOpen(false);
    clearSearch();
  }, [clearSearch]);

  const handleOpen = useCallback(async () => {
    await openFile();
  }, [openFile]);

  const handleOpenRecent = useCallback(async (path: string) => {
    await openPath(path);
  }, [openPath]);

  const handlePrevPage = useCallback(() => {
    const target = Math.max(1, currentPage - 1);
    scrollToPageRef.current?.(target);
  }, [currentPage]);

  const handleNextPage = useCallback(() => {
    const target = Math.min(totalPages, currentPage + 1);
    scrollToPageRef.current?.(target);
  }, [currentPage, totalPages]);

  const handleThumbnailClick = useCallback((pageNumber: number) => {
    scrollToPageRef.current?.(pageNumber);
  }, []);

  const handleToggleGallery = useCallback(() => {
    setViewMode((m) => (m === "scroll" ? "gallery" : "scroll"));
  }, []);

  const handleGalleryPageClick = useCallback((pageNumber: number) => {
    setViewMode("scroll");
    setTimeout(() => scrollToPageRef.current?.(pageNumber), 0);
  }, []);

  const handleSave = useCallback(async () => {
    if (!metadata?.path) return;
    try {
      const saveData = toSaveData(annotations);
      await invoke("save_annotations", {
        path: metadata.path,
        annotations: saveData,
      });
      markSaved();
    } catch (err) {
      console.error("Failed to save annotations:", err);
    }
  }, [metadata?.path, annotations, markSaved]);

  const handlePrint = useCallback(async () => {
    if (!metadata?.path) return;
    try {
      if (hasChanges) await handleSave();
      await invoke("print_pdf", { path: metadata.path });
    } catch (err) {
      console.error("Failed to print:", err);
    }
  }, [metadata?.path, hasChanges, handleSave]);

  const handleDeletePage = useCallback(async (pageNumber: number) => {
    if (!metadata?.path || totalPages <= 1) return;
    try {
      if (hasChanges) await handleSave();
      const confirmed = await ask(`Delete page ${pageNumber}?`, {
        title: "Delete Page",
        kind: "warning",
        okLabel: "Delete",
        cancelLabel: "Cancel",
      });
      if (!confirmed) return;
      await invoke("delete_pages", { path: metadata.path, pageNumbers: [pageNumber] });
      await openPath(metadata.path);
    } catch (err) {
      console.error("Failed to delete page:", err);
    }
  }, [metadata?.path, totalPages, hasChanges, handleSave, openPath]);

  const handleReorderPage = useCallback(async (from: number, to: number) => {
    if (!metadata?.path || from === to) return;
    try {
      if (hasChanges) await handleSave();
      pageUndoStackRef.current.push({ from, to });
      if (pageUndoStackRef.current.length > 50) pageUndoStackRef.current.shift();
      await invoke("reorder_page", { path: metadata.path, from, to });
      await openPath(metadata.path);
    } catch (err) {
      // Remove the entry if the reorder failed
      pageUndoStackRef.current.pop();
      console.error("Failed to reorder page:", err);
    }
  }, [metadata?.path, hasChanges, handleSave, openPath]);

  const handleUndoReorder = useCallback(async () => {
    const entry = pageUndoStackRef.current.pop();
    if (!entry || !metadata?.path) return;
    try {
      if (hasChanges) await handleSave();
      // Reverse the reorder
      await invoke("reorder_page", { path: metadata.path, from: entry.to, to: entry.from });
      await openPath(metadata.path);
    } catch (err) {
      // Put it back if undo failed
      pageUndoStackRef.current.push(entry);
      console.error("Failed to undo page reorder:", err);
    }
  }, [metadata?.path, hasChanges, handleSave, openPath]);

  const handleSaveAs = useCallback(async () => {
    if (!metadata?.path) return;
    try {
      if (hasChanges) await handleSave();
      const dest = await save({
        title: "Save PDF As",
        filters: [{ name: "PDF", extensions: ["pdf"] }],
      });
      if (!dest) return;
      await invoke("save_pdf_as", { source: metadata.path, dest });
      await openPath(dest);
    } catch (err) {
      console.error("Failed to save as:", err);
    }
  }, [metadata?.path, hasChanges, handleSave, openPath]);

  // Keyboard shortcuts
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        if (!undo()) {
          handleUndoReorder();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "z" || e.key === "Z")) {
        e.preventDefault();
        redo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        if (searchOpen) {
          searchBarRef.current?.focus();
        } else {
          setSearchOpen(true);
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "p") {
        e.preventDefault();
        handlePrint();
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        handleSaveAs();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo, handleUndoReorder, searchOpen, handlePrint, handleSaveAs]);

  // Listen for native menu events
  useEffect(() => {
    const unlistenOpen = listen<void>("menu-open-file", () => {
      openFile();
    });
    const unlistenRecent = listen<string>("menu-open-recent", (event) => {
      openPath(event.payload);
    });
    const unlistenSave = listen<void>("menu-save", () => {
      handleSave();
    });
    const unlistenSaveAs = listen<void>("menu-save-as", () => {
      handleSaveAs();
    });
    const unlistenPrint = listen<void>("menu-print", () => {
      handlePrint();
    });
    return () => {
      unlistenOpen.then((f) => f());
      unlistenRecent.then((f) => f());
      unlistenSave.then((f) => f());
      unlistenSaveAs.then((f) => f());
      unlistenPrint.then((f) => f());
    };
  }, [openFile, openPath, handleSave, handleSaveAs, handlePrint]);

  // Drag-and-drop file open
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type === "drop") {
        const pdf = event.payload.paths.find((p) => p.toLowerCase().endsWith(".pdf"));
        if (pdf) openPath(pdf);
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, [openPath]);

  // Fit width / fit page zoom
  const handleFitWidth = useCallback(() => {
    const container = viewerContainerRef.current;
    if (!container || pageDimensions.length === 0) return;
    const padding = 48; // matches pdf-scroll-container padding (24px * 2)
    const availableWidth = container.clientWidth - padding;
    const pageWidth = pageDimensions[currentPage - 1]?.width ?? pageDimensions[0].width;
    setZoom(availableWidth / pageWidth);
  }, [pageDimensions, currentPage]);

  const handleFitPage = useCallback(() => {
    const container = viewerContainerRef.current;
    if (!container || pageDimensions.length === 0) return;
    const padding = 48;
    const availableWidth = container.clientWidth - padding;
    const availableHeight = container.clientHeight - padding;
    const dim = pageDimensions[currentPage - 1] ?? pageDimensions[0];
    const fitW = availableWidth / dim.width;
    const fitH = availableHeight / dim.height;
    setZoom(Math.min(fitW, fitH));
  }, [pageDimensions, currentPage]);

  const handleCurrentPageChange = useCallback((page: number) => {
    setCurrentPage(page);
  }, []);

  const displayError = error || docError;

  return (
    <div className="app">
      <Toolbar
        fileName={fileName}
        currentPage={currentPage}
        totalPages={totalPages}
        zoom={zoom}
        loading={loading}
        sidebarOpen={sidebarOpen}
        activeTool={activeTool}
        hasUnsavedChanges={hasChanges}
        viewMode={viewMode}
        onOpen={handleOpen}
        onPrevPage={handlePrevPage}
        onNextPage={handleNextPage}
        onZoomChange={setZoom}
        onFitWidth={handleFitWidth}
        onFitPage={handleFitPage}
        onToggleSidebar={() => setSidebarOpen((s) => !s)}
        onToggleGallery={handleToggleGallery}
        onToolChange={setActiveTool}
        onSave={handleSave}
        onPrint={handlePrint}
      />

      <div className="content">
        {displayError && <div className="error-banner">{displayError}</div>}

        {searchOpen && (
          <SearchBar
            ref={searchBarRef}
            matchCount={searchMatches.length}
            currentMatchIndex={currentMatchIndex}
            searching={searching}
            onSearch={search}
            onNext={nextMatch}
            onPrev={prevMatch}
            onClose={handleCloseSearch}
          />
        )}

        {pdfDoc && pageDimensions.length > 0 ? (
          <div className="content-body">
            {viewMode === "gallery" ? (
              <PageGallery
                pdfDoc={pdfDoc}
                pageDimensions={pageDimensions}
                onPageClick={handleGalleryPageClick}
                onDeletePage={handleDeletePage}
                onReorderPage={handleReorderPage}
              />
            ) : (
              <>
                {sidebarOpen && (
                  <ThumbnailSidebar
                    pdfDoc={pdfDoc}
                    pageDimensions={pageDimensions}
                    currentPage={currentPage}
                    onPageClick={handleThumbnailClick}
                    onDeletePage={handleDeletePage}
                    onReorderPage={handleReorderPage}
                  />
                )}
                <PdfViewer
                  pdfDoc={pdfDoc}
                  pageDimensions={pageDimensions}
                  zoom={zoom}
                  onZoomChange={setZoom}
                  onCurrentPageChange={handleCurrentPageChange}
                  scrollToPageRef={scrollToPageRef}
                  viewerContainerRef={viewerContainerRef}
                  activeTool={activeTool}
                  onAddAnnotation={add}
                  onUpdateAnnotation={update}
                  onDeleteAnnotation={remove}
                  getPageAnnotations={getPageAnnotations}
                  searchQuery={searchQuery}
                  searchMatches={searchMatches}
                  currentMatch={currentMatch}
                />
              </>
            )}
          </div>
        ) : (
          <div className="empty-state">
            <p>Open a PDF to get started</p>
            <button onClick={handleOpen}>Open PDF</button>

            {recentFiles.length > 0 && (
              <div className="recent-files">
                <h3>Recent</h3>
                <ul>
                  {recentFiles.slice(0, 5).map((f) => (
                    <li key={f.path}>
                      <a
                        className="recent-file-link"
                        onClick={() => !loading && handleOpenRecent(f.path)}
                        title={f.path}
                      >
                        {f.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;
