import { useEffect, useMemo } from "react";
import type { PdfDocument } from "../lib/pdf";
import type { PageDimension, AnnotationTool, Annotation } from "../types";
import type { SearchMatch } from "../hooks/useTextSearch";
import { usePageVisibility } from "../hooks/usePageVisibility";
import { PageCanvas } from "./PageCanvas";

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;

interface PdfViewerProps {
  pdfDoc: PdfDocument;
  pageDimensions: PageDimension[];
  zoom: number;
  onZoomChange: (zoom: number) => void;
  onCurrentPageChange: (page: number) => void;
  scrollToPageRef: React.MutableRefObject<((page: number) => void) | null>;
  viewerContainerRef?: React.MutableRefObject<HTMLDivElement | null>;
  activeTool: AnnotationTool;
  highlightColor: string;
  onAddAnnotation: (annotation: Annotation) => void;
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  onDeleteAnnotation: (id: string) => void;
  getPageAnnotations: (pageNumber: number) => Annotation[];
  searchQuery: string;
  searchMatches: SearchMatch[];
  currentMatch: SearchMatch | null;
  pendingSignature?: string | null;
}

export function PdfViewer({
  pdfDoc,
  pageDimensions,
  zoom,
  onZoomChange,
  onCurrentPageChange,
  scrollToPageRef,
  viewerContainerRef,
  activeTool,
  highlightColor,
  onAddAnnotation,
  onUpdateAnnotation,
  onDeleteAnnotation,
  getPageAnnotations,
  searchQuery,
  searchMatches,
  currentMatch,
  pendingSignature,
}: PdfViewerProps) {
  const { containerRef, visiblePages, currentPage, scrollToPage } = usePageVisibility({
    zoom,
    totalPages: pageDimensions.length,
  });

  // Group search matches by page
  const matchesByPage = useMemo(() => {
    const map = new Map<number, SearchMatch[]>();
    for (const m of searchMatches) {
      let arr = map.get(m.pageNumber);
      if (!arr) {
        arr = [];
        map.set(m.pageNumber, arr);
      }
      arr.push(m);
    }
    return map;
  }, [searchMatches]);

  // Expose scrollToPage and container ref to parent
  useEffect(() => {
    scrollToPageRef.current = scrollToPage;
  }, [scrollToPage, scrollToPageRef]);

  useEffect(() => {
    if (viewerContainerRef) {
      viewerContainerRef.current = containerRef.current;
    }
  }, [viewerContainerRef, containerRef]);

  // Report current page changes
  useEffect(() => {
    onCurrentPageChange(currentPage);
  }, [currentPage, onCurrentPageChange]);

  // Pinch-to-zoom (trackpad) and Ctrl+scroll
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleWheel(e: WheelEvent) {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();

      const delta = -e.deltaY * 0.01;
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom * (1 + delta)));
      if (newZoom === zoom) return;

      // Anchor zoom to cursor: keep the content point under the mouse fixed
      const rect = container!.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const contentX = container!.scrollLeft + mouseX;
      const contentY = container!.scrollTop + mouseY;
      const ratio = newZoom / zoom;

      onZoomChange(newZoom);

      // Adjust scroll after React re-renders with new zoom
      requestAnimationFrame(() => {
        container!.scrollLeft = contentX * ratio - mouseX;
        container!.scrollTop = contentY * ratio - mouseY;
      });
    }

    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, [zoom, onZoomChange, containerRef]);

  return (
    <div className="pdf-scroll-container" ref={containerRef}>
      {pageDimensions.map((dim) => {
        const pageMatches = matchesByPage.get(dim.pageNumber) ?? [];
        const selectedMatchIndex = currentMatch && currentMatch.pageNumber === dim.pageNumber
          ? pageMatches.findIndex((m) => m.index === currentMatch.index)
          : -1;

        return (
          <PageCanvas
            key={dim.pageNumber}
            pdfDoc={pdfDoc}
            dimension={dim}
            zoom={zoom}
            isVisible={visiblePages.has(dim.pageNumber)}
            annotations={getPageAnnotations(dim.pageNumber)}
            activeTool={activeTool}
            highlightColor={highlightColor}
            onAddAnnotation={onAddAnnotation}
            onUpdateAnnotation={onUpdateAnnotation}
            onDeleteAnnotation={onDeleteAnnotation}
            searchQuery={searchQuery}
            searchMatches={pageMatches}
            selectedMatchIndex={selectedMatchIndex}
            pendingSignature={pendingSignature}
          />
        );
      })}
    </div>
  );
}
