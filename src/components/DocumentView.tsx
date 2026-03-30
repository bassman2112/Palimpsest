import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { ask, save, open } from "@tauri-apps/plugin-dialog";
import { useFileOpen } from "../hooks/useFileOpen";
import { usePdfDocument } from "../hooks/usePdfDocument";
import { useAnnotations } from "../hooks/useAnnotations";
import { useTextSearch } from "../hooks/useTextSearch";
import { useMergeDocuments } from "../hooks/useMergeDocuments";
import { Toolbar } from "./Toolbar";
import { PdfViewer } from "./PdfViewer";
import { ThumbnailSidebar } from "./ThumbnailSidebar";
import { PageGallery } from "./PageGallery";
import { SearchBar } from "./SearchBar";
import { SignatureModal } from "./SignatureModal";
import { OutlineSidebar } from "./OutlineSidebar";
import { ExportDialog } from "./ExportDialog";
import type { SignatureKind } from "./SignatureModal";
import type { SearchBarHandle } from "./SearchBar";
import type { AnnotationTool, Annotation } from "../types";
import type { OutlineItem } from "../lib/pdf/types";
import type { RecentFile } from "../hooks/useRecentFiles";
import { useSavedSignatures } from "../hooks/useSavedSignatures";
import { useCustomBookmarks } from "../hooks/useCustomBookmarks";
import { FIT_ZOOM_PADDING } from "../constants";
import {
  toSaveData,
  toInkSaveData,
  toShapeSaveData,
  toTextSaveData,
  toSignatureData,
  toRedactionSaveData,
} from "../lib/save";
import type { FormFieldSaveData } from "../lib/save";

export interface DocumentViewHandle {
  save: () => void;
  saveAs: () => void;
  saveLocked: () => void;
  print: () => void;
  openFile: () => void;
  openPath: (path: string) => void;
  closeFile: () => void;
  saveMerged: () => void;
  merge: () => void;
  toggleSidebar: () => void;
  toggleGallery: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
  fitWidth: () => void;
  fitPage: () => void;
  find: () => void;
}

interface DocumentViewProps {
  isActive: boolean;
  initialPath?: string;
  recentFiles: RecentFile[];
  onAddRecent: (path: string) => void;
  onTabInfoChange: (info: { title: string; hasChanges: boolean }) => void;
}

export const DocumentView = forwardRef<DocumentViewHandle, DocumentViewProps>(
  function DocumentView(
    { isActive, initialPath, recentFiles, onAddRecent, onTabInfoChange },
    ref
  ) {
    const { data, metadata, loading, error, openFile, openPath, closeFile, initialAnnotations } =
      useFileOpen();
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

    const {
      mergePages,
      isMerging,
      enterMerge,
      addDocument: mergeAddDocument,
      addDocumentByPath: mergeAddDocumentByPath,
      removePage: mergeRemovePage,
      removePages: mergeRemovePages,
      reorderPage: mergeReorderPage,
      reorderPages: mergeReorderPages,
      clearMerge,
      undo: mergeUndo,
    } = useMergeDocuments();

    const { signatures: savedSignatures, addSignature: saveSig, removeSignature: deleteSavedSig } = useSavedSignatures();
    const { bookmarks: customBookmarks, isBookmarked, toggleBookmark, updateLabel: updateBookmarkLabel, removeBookmark } = useCustomBookmarks(metadata?.path ?? null);

    const [currentPage, setCurrentPage] = useState(1);
    const [zoom, setZoom] = useState(1);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [activeTool, setActiveTool] = useState<AnnotationTool>("none");
    const [searchOpen, setSearchOpen] = useState(false);
    const [viewMode, setViewMode] = useState<"scroll" | "gallery">("scroll");
    const [signatureModalOpen, setSignatureModalOpen] = useState(false);
    const [pendingSignature, setPendingSignature] = useState<string | null>(null);
    const [signatureKind, setSignatureKind] = useState<SignatureKind>("signature");
    const highlightColor = "#ffff00";
    const strokeWidth = 2;
    const [hasFormChanges, setHasFormChanges] = useState(false);
    const [signatureSavePrompt, setSignatureSavePrompt] = useState(false);
    const [redactionSavePrompt, setRedactionSavePrompt] = useState(false);
    const [bookmarksOpen, setBookmarksOpen] = useState(false);
    const [outline, setOutline] = useState<OutlineItem[] | null>(null);
    const [exportDialogOpen, setExportDialogOpen] = useState(false);

    // Resizable sidebar
    const SIDEBAR_MIN = 120;
    const SIDEBAR_MAX = 400;
    const SIDEBAR_DEFAULT = 200;
    const SIDEBAR_STORAGE_KEY = "palimpsest-sidebar-width";
    const [sidebarWidth, setSidebarWidth] = useState(() => {
      const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
      if (raw) {
        const n = parseInt(raw, 10);
        if (!isNaN(n)) return Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, n));
      }
      return SIDEBAR_DEFAULT;
    });
    const sidebarWidthRef = useRef(sidebarWidth);
    sidebarWidthRef.current = sidebarWidth;
    const sidebarThumbSize = Math.max(80, sidebarWidth - 40);

    const scrollToPageRef = useRef<((page: number) => void) | null>(null);
    const viewerContainerRef = useRef<HTMLDivElement | null>(null);
    const searchBarRef = useRef<SearchBarHandle>(null);
    // Stores page operations for undo (reorder or rotate)
    type PageUndoEntry =
      | { type: "reorder"; undoOrder: number[]; originalPages: number[] }
      | { type: "rotate"; pageNumbers: number[]; degrees: number };
    const pageUndoStackRef = useRef<PageUndoEntry[]>([]);
    // Selection to restore in gallery after reorder/undo (ref to avoid timing issues with state)
    const galleryPendingSelectionRef = useRef<number[] | null>(null);

    const fileName = metadata?.path.split(/[\\/]/).pop() ?? null;
    const totalPages = pageDimensions.length;

    const handleSidebarResizeStart = useCallback((e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = sidebarWidthRef.current;

      const onMouseMove = (ev: MouseEvent) => {
        const newWidth = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startWidth + (ev.clientX - startX)));
        setSidebarWidth(newWidth);
        localStorage.setItem(SIDEBAR_STORAGE_KEY, String(newWidth));
      };

      const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
      };

      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }, []);

    const handleSidebarResetWidth = useCallback(() => {
      setSidebarWidth(SIDEBAR_DEFAULT);
      localStorage.setItem(SIDEBAR_STORAGE_KEY, String(SIDEBAR_DEFAULT));
    }, []);

    // Load initial path on mount
    const initialPathLoadedRef = useRef(false);
    useEffect(() => {
      if (initialPath && !initialPathLoadedRef.current) {
        initialPathLoadedRef.current = true;
        openPath(initialPath);
      }
    }, [initialPath, openPath]);

    // Load initial annotations when a new file is opened
    useEffect(() => {
      resetAnnotations(initialAnnotations);
      setCurrentPage(1);
    }, [initialAnnotations, resetAnnotations]);

    // Clear page undo stack when a different file is opened
    const prevPathRef = useRef(metadata?.path);
    useEffect(() => {
      if (metadata?.path !== prevPathRef.current) {
        const prevPath = prevPathRef.current;
        prevPathRef.current = metadata?.path;
        if (prevPath && metadata?.path && prevPath !== metadata.path) {
          pageUndoStackRef.current = [];
        }
      }
    }, [metadata?.path]);

    // Track opened file in recents
    const onAddRecentRef = useRef(onAddRecent);
    onAddRecentRef.current = onAddRecent;
    useEffect(() => {
      if (metadata?.path) {
        onAddRecentRef.current(metadata.path);
      }
    }, [metadata?.path]);

    // Report tab info changes (use ref to avoid infinite loop from callback identity changes)
    const onTabInfoChangeRef = useRef(onTabInfoChange);
    onTabInfoChangeRef.current = onTabInfoChange;
    useEffect(() => {
      onTabInfoChangeRef.current({
        title: fileName ?? "New Tab",
        hasChanges: hasChanges || hasFormChanges,
      });
    }, [fileName, hasChanges, hasFormChanges]);

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

    const handleOpenRecent = useCallback(
      async (path: string) => {
        await openPath(path);
      },
      [openPath]
    );

    const handlePrevPage = useCallback(() => {
      const target = Math.max(1, currentPage - 1);
      scrollToPageRef.current?.(target);
    }, [currentPage]);

    const handleNextPage = useCallback(() => {
      const target = Math.min(totalPages, currentPage + 1);
      scrollToPageRef.current?.(target);
    }, [currentPage, totalPages]);

    const handleGoToPage = useCallback((page: number) => {
      scrollToPageRef.current?.(page);
    }, []);

    const handleThumbnailClick = useCallback((pageNumber: number) => {
      scrollToPageRef.current?.(pageNumber);
    }, []);

    const handleToggleGallery = useCallback(() => {
      setViewMode((m) => (m === "scroll" ? "gallery" : "scroll"));
    }, []);

    const handleToggleBookmarks = useCallback(() => {
      setBookmarksOpen((b) => !b);
    }, []);

    const handleGalleryPageClick = useCallback(
      (pageNumber: number) => {
        if (isMerging) return;
        setViewMode("scroll");
        setTimeout(() => scrollToPageRef.current?.(pageNumber), 0);
      },
      [isMerging]
    );

    const doSave = useCallback(async () => {
      if (!metadata?.path) return;
      try {
        // Save highlights and sticky notes
        const saveData = toSaveData(annotations);
        await invoke("save_annotations", {
          path: metadata.path,
          annotations: saveData,
        });

        // Save ink annotations
        const inkData = toInkSaveData(annotations);
        if (inkData.length > 0) {
          await invoke("save_ink_annotations", {
            path: metadata.path,
            annotations: inkData,
          });
        }

        // Save shape annotations
        const shapeData = toShapeSaveData(annotations);
        if (shapeData.length > 0) {
          await invoke("save_shape_annotations", {
            path: metadata.path,
            annotations: shapeData,
          });
        }

        // Save text annotations (FreeText)
        const textData = toTextSaveData(annotations);
        if (textData.length > 0) {
          await invoke("save_text_annotations", {
            path: metadata.path,
            annotations: textData,
          });
        }

        // Save redaction annotations
        const redactData = toRedactionSaveData(annotations);
        if (redactData.length > 0) {
          await invoke("save_redaction_annotations", {
            path: metadata.path,
            annotations: redactData,
          });
        }

        // Embed signatures
        const sigData = toSignatureData(annotations);
        if (sigData.length > 0) {
          await invoke("embed_signatures", {
            path: metadata.path,
            signatures: sigData,
          });
        }

        // Save form field values
        if (pdfDoc && hasFormChanges) {
          try {
            const formData = pdfDoc.getFormData();
            if (formData) {
              const fields: FormFieldSaveData[] = Object.entries(formData).map(
                ([key, val]) => ({
                  field_name: key,
                  value: val.value,
                  field_type: val.type ?? "text",
                })
              );
              if (fields.length > 0) {
                await invoke("save_form_fields", {
                  path: metadata.path,
                  fields,
                });
              }
            }
          } catch (formErr) {
            console.error("Failed to save form fields:", formErr);
          }
          setHasFormChanges(false);
        }

        markSaved();
      } catch (err) {
        console.error("Failed to save annotations:", err);
      }
    }, [metadata?.path, annotations, markSaved, pdfDoc, hasFormChanges]);

    const handleSave = useCallback(() => {
      const hasSignatures = annotations.some((a) => a.type === "signature");
      const hasRedactions = annotations.some((a) => a.type === "redaction");
      if (hasSignatures) {
        setSignatureSavePrompt(true);
      } else if (hasRedactions) {
        setRedactionSavePrompt(true);
      } else {
        doSave();
      }
    }, [annotations, doSave]);

    const handlePrint = useCallback(async () => {
      if (!metadata?.path) return;
      try {
        if (hasChanges) await handleSave();
        await invoke("print_pdf", { path: metadata.path });
      } catch (err) {
        console.error("Failed to print:", err);
      }
    }, [metadata?.path, hasChanges, handleSave]);

    const handleDeletePage = useCallback(
      async (pageNumber: number) => {
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
      },
      [metadata?.path, totalPages, hasChanges, handleSave, openPath]
    );

    const handleRotatePage = useCallback(
      async (pageNumbers: number[], degrees: number) => {
        if (!metadata?.path) return;
        try {
          if (hasChanges) await handleSave();
          pageUndoStackRef.current.push({ type: "rotate", pageNumbers: [...pageNumbers], degrees });
          if (pageUndoStackRef.current.length > 50) pageUndoStackRef.current.shift();
          galleryPendingSelectionRef.current = [...pageNumbers];
          await invoke("rotate_pages", { path: metadata.path, pageNumbers, degrees });
          await openPath(metadata.path);
        } catch (err) {
          pageUndoStackRef.current.pop();
          console.error("Failed to rotate page:", err);
        }
      },
      [metadata?.path, hasChanges, handleSave, openPath]
    );

    const handleExtractPages = useCallback(
      async (pageNumbers: number[]) => {
        if (!metadata?.path || pageNumbers.length === 0) return;
        try {
          if (hasChanges) await handleSave();
          const dest = await save({
            title: "Save Extracted Pages",
            filters: [{ name: "PDF", extensions: ["pdf"] }],
          });
          if (!dest) return;
          await invoke("extract_pages", { path: metadata.path, pageNumbers, dest });
          await openPath(dest);
        } catch (err) {
          console.error("Failed to extract pages:", err);
        }
      },
      [metadata?.path, hasChanges, handleSave, openPath]
    );

    const handleSplitPdf = useCallback(
      async (afterPage: number) => {
        if (!metadata?.path) return;
        try {
          if (hasChanges) await handleSave();
          const destFirst = await save({
            title: "Save First Part",
            filters: [{ name: "PDF", extensions: ["pdf"] }],
          });
          if (!destFirst) return;
          // Auto-name second half
          const ext = destFirst.lastIndexOf(".");
          const destSecond = ext > 0
            ? destFirst.slice(0, ext) + "_part2" + destFirst.slice(ext)
            : destFirst + "_part2";
          await invoke("split_pdf", {
            path: metadata.path,
            afterPage,
            destFirst,
            destSecond,
          });
          await openPath(destFirst);
        } catch (err) {
          console.error("Failed to split PDF:", err);
        }
      },
      [metadata?.path, hasChanges, handleSave, openPath]
    );

    const handleInsertBlankPage = useCallback(
      async (afterPage: number) => {
        if (!metadata?.path) return;
        try {
          if (hasChanges) await handleSave();
          await invoke("insert_blank_page", {
            path: metadata.path,
            afterPage,
            width: 612.0,
            height: 792.0,
          });
          await openPath(metadata.path);
        } catch (err) {
          console.error("Failed to insert blank page:", err);
        }
      },
      [metadata?.path, hasChanges, handleSave, openPath]
    );

    const handleInsertImagePage = useCallback(
      async (afterPage: number) => {
        if (!metadata?.path) return;
        try {
          const selected = await open({
            title: "Select Image",
            filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg"] }],
            multiple: false,
          });
          if (!selected) return;
          const imagePath = selected;
          // Read image file as base64 via Tauri
          const imageBase64: string = await invoke("read_pdf_bytes", { path: imagePath });
          if (hasChanges) await handleSave();
          await invoke("insert_image_page", {
            path: metadata.path,
            afterPage,
            imageBase64,
          });
          await openPath(metadata.path);
        } catch (err) {
          console.error("Failed to insert image page:", err);
        }
      },
      [metadata?.path, hasChanges, handleSave, openPath]
    );

    // Compute the inverse permutation of a reorder so set_page_order can reverse it.
    // forwardPerm[i] = the original page number now at position i (1-based).
    // Returns inversePerm where inversePerm[i] = the current position of original page i+1.
    const invertPerm = (perm: number[]): number[] => {
      const inv = new Array(perm.length);
      for (let i = 0; i < perm.length; i++) {
        inv[perm[i] - 1] = i + 1;
      }
      return inv;
    };

    const handleReorderPage = useCallback(
      async (from: number, to: number) => {
        if (!metadata?.path || from === to) return;
        try {
          if (hasChanges) await handleSave();
          // Compute forward permutation: simulate moving page `from` to `to`
          const fwd = Array.from({ length: totalPages }, (_, i) => i + 1);
          const item = fwd.splice(from - 1, 1)[0];
          fwd.splice(to - 1, 0, item);
          pageUndoStackRef.current.push({ type: "reorder", undoOrder: invertPerm(fwd), originalPages: [from] });
          if (pageUndoStackRef.current.length > 50) pageUndoStackRef.current.shift();
          await invoke("reorder_page", { path: metadata.path, from, to });
          await openPath(metadata.path);
        } catch (err) {
          pageUndoStackRef.current.pop();
          console.error("Failed to reorder page:", err);
        }
      },
      [metadata?.path, totalPages, hasChanges, handleSave, openPath]
    );

    const handleReorderPages = useCallback(
      async (pages: number[], insertBefore: number) => {
        if (!metadata?.path || pages.length === 0) return;
        try {
          if (hasChanges) await handleSave();
          // Compute forward permutation: simulate removing `pages` and inserting at `insertBefore`
          const order = Array.from({ length: totalPages }, (_, i) => i + 1);
          const movedSet = new Set(pages);
          const remaining = order.filter((p) => !movedSet.has(p));
          const insertIdx = insertBefore - 1;
          let adjusted = 0;
          for (let i = 0; i < insertIdx; i++) {
            if (!movedSet.has(i + 1)) adjusted++;
          }
          const fwd = [...remaining];
          for (let i = 0; i < pages.length; i++) {
            fwd.splice(adjusted + i, 0, pages[i]);
          }
          pageUndoStackRef.current.push({ type: "reorder", undoOrder: invertPerm(fwd), originalPages: [...pages] });
          if (pageUndoStackRef.current.length > 50) pageUndoStackRef.current.shift();
          await invoke("reorder_pages", { path: metadata.path, pages, insertBefore });
          await openPath(metadata.path);
        } catch (err) {
          pageUndoStackRef.current.pop();
          console.error("Failed to reorder pages:", err);
        }
      },
      [metadata?.path, totalPages, hasChanges, handleSave, openPath]
    );

    const handleUndoPageOp = useCallback(async () => {
      const entry = pageUndoStackRef.current.pop();
      if (!entry || !metadata?.path) return;
      try {
        if (hasChanges) await handleSave();
        if (entry.type === "reorder") {
          galleryPendingSelectionRef.current = entry.originalPages;
          await invoke("set_page_order", { path: metadata.path, order: entry.undoOrder });
        } else {
          // Rotate undo: apply inverse rotation
          await invoke("rotate_pages", {
            path: metadata.path,
            pageNumbers: entry.pageNumbers,
            degrees: -entry.degrees,
          });
        }
        await openPath(metadata.path);
      } catch (err) {
        pageUndoStackRef.current.push(entry);
        console.error("Failed to undo page operation:", err);
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

    const handleSaveLocked = useCallback(async () => {
      if (!metadata?.path) return;
      try {
        if (hasChanges) await handleSave();
        const dest = await save({
          title: "Save Flattened Copy",
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (!dest) return;
        await invoke("save_locked", { source: metadata.path, dest });
      } catch (err) {
        console.error("Failed to save flattened PDF:", err);
      }
    }, [metadata?.path, hasChanges, handleSave]);

    // Merge mode handlers
    const handleAddDocument = useCallback(async () => {
      if (!isMerging && pdfDoc && metadata?.path && pageDimensions.length > 0) {
        enterMerge({
          path: metadata.path,
          fileName: metadata.path.split(/[\\/]/).pop() ?? metadata.path,
          pdfDoc,
          pageDimensions,
        });
        setViewMode("gallery");
      }
      await mergeAddDocument();
    }, [isMerging, pdfDoc, metadata?.path, pageDimensions, enterMerge, mergeAddDocument]);

    const handleSaveMerged = useCallback(async () => {
      if (mergePages.length === 0) return;
      try {
        const dest = await save({
          title: "Save Merged PDF",
          filters: [{ name: "PDF", extensions: ["pdf"] }],
        });
        if (!dest) return;

        const pages = mergePages.map((mp) => ({
          path: mp.sourcePath,
          page_number: mp.sourcePageNumber,
        }));

        await invoke("merge_pdfs", { pages, dest });
        clearMerge();
        await openPath(dest);
        setViewMode("scroll");
      } catch (err) {
        console.error("Failed to save merged PDF:", err);
      }
    }, [mergePages, clearMerge, openPath]);

    const handleExitMerge = useCallback(() => {
      clearMerge();
      setViewMode("scroll");
    }, [clearMerge]);

    const handleCloseFile = useCallback(() => {
      if (isMerging) clearMerge();
      closeFile();
      setViewMode("scroll");
      setSearchOpen(false);
      setActiveTool("none");
    }, [isMerging, clearMerge, closeFile]);

    // Keyboard shortcuts (only when this tab is active)
    useEffect(() => {
      if (!isActive) return;
      function handleKeyDown(e: KeyboardEvent) {
        if ((e.metaKey || e.ctrlKey) && e.key === "z" && !e.shiftKey) {
          e.preventDefault();
          if (isMerging) {
            mergeUndo();
          } else if (!undo()) {
            handleUndoPageOp();
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
        if (e.key === "Escape" && activeTool !== "none") {
          setActiveTool("none");
        }
      }
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }, [
      isActive,
      activeTool,
      undo,
      redo,
      handleUndoPageOp,
      searchOpen,
      handlePrint,
      handleSaveAs,
      isMerging,
      mergeUndo,
    ]);

    // Drag-and-drop file open
    useEffect(() => {
      const unlisten = getCurrentWebview().onDragDropEvent((event) => {
        if (!isActive) return;
        if (event.payload.type === "drop") {
          const pdf = event.payload.paths.find((p) => p.toLowerCase().endsWith(".pdf"));
          if (pdf) {
            if (isMerging && viewMode === "gallery") {
              mergeAddDocumentByPath(pdf);
            } else if (pdfDoc) {
              // Already have a document open — open in a new tab
              emit("open-file-path", pdf);
            } else {
              openPath(pdf);
            }
          }
        }
      });
      return () => {
        unlisten.then((f) => f());
      };
    }, [isActive, openPath, pdfDoc, isMerging, viewMode, mergeAddDocumentByPath]);

    // Detect form field changes
    useEffect(() => {
      if (!pdfDoc) return;
      return pdfDoc.onFormModified(() => setHasFormChanges(true));
    }, [pdfDoc]);

    // Reset form change tracking when file changes
    useEffect(() => {
      setHasFormChanges(false);
    }, [metadata?.path]);

    // Load outline when PDF document changes
    useEffect(() => {
      if (!pdfDoc) {
        setOutline(null);
        return;
      }
      pdfDoc.getOutline().then((o) => setOutline(o));
    }, [pdfDoc]);

    // Signature modal handlers
    const handleSignatureClick = useCallback(() => {
      if (pendingSignature) {
        // Already have a pending signature, just activate tool
        setActiveTool("signature");
      } else {
        setSignatureModalOpen(true);
      }
    }, [pendingSignature]);

    const handleSignatureApply = useCallback((imageData: string) => {
      setPendingSignature(imageData);
      setSignatureModalOpen(false);
      setActiveTool("signature");
    }, []);

    const handleSignatureModalClose = useCallback(() => {
      setSignatureModalOpen(false);
    }, []);

    // Clear pending signature when annotation is placed (tool switches back to none)
    const handleToolChange = useCallback((tool: AnnotationTool) => {
      setActiveTool(tool);
      if (tool !== "signature") {
        setPendingSignature(null);
      }
    }, []);

    const handleApplyRedactions = useCallback(async () => {
      if (!metadata?.path) return;
      const hasRedactions = annotations.some((a) => a.type === "redaction");
      if (!hasRedactions) return;
      try {
        const confirmed = await ask(
          "This will permanently cover the redacted areas with black rectangles. The content underneath will be visually hidden. Continue?",
          { title: "Apply Redactions", kind: "warning", okLabel: "Apply", cancelLabel: "Cancel" }
        );
        if (!confirmed) return;
        if (hasChanges) await doSave();
        await invoke("apply_redactions", { path: metadata.path });
        await openPath(metadata.path);
      } catch (err) {
        console.error("Failed to apply redactions:", err);
      }
    }, [metadata?.path, annotations, hasChanges, doSave, openPath]);

    const handleApplySingleRedaction = useCallback(async (annotationId: string) => {
      if (!metadata?.path) return;
      const ann = annotations.find((a) => a.id === annotationId && a.type === "redaction");
      if (!ann || ann.type !== "redaction") return;
      try {
        const confirmed = await ask(
          "This will permanently and irreversibly cover this redacted area with black — the content underneath cannot be recovered. Continue?",
          { title: "Apply Redaction", kind: "warning", okLabel: "Apply", cancelLabel: "Cancel" }
        );
        if (!confirmed) return;
        if (hasChanges) await doSave();
        await invoke("apply_single_redaction", {
          path: metadata.path,
          annotation: {
            page_number: ann.pageNumber,
            x: ann.x,
            y: ann.y,
            width: ann.width,
            height: ann.height,
          },
        });
        await openPath(metadata.path);
      } catch (err) {
        console.error("Failed to apply single redaction:", err);
      }
    }, [metadata?.path, annotations, hasChanges, doSave, openPath]);

    // When signature annotation is added, clear pending signature
    const handleAddAnnotation = useCallback((annotation: Annotation) => {
      add(annotation);
      if (annotation.type === "signature") {
        setPendingSignature(null);
        setActiveTool("none");
      }
    }, [add]);

    // Fit width / fit page zoom
    const handleFitWidth = useCallback(() => {
      const container = viewerContainerRef.current;
      if (!container || pageDimensions.length === 0) return;
      const availableWidth = container.clientWidth - FIT_ZOOM_PADDING;
      const pageWidth = pageDimensions[currentPage - 1]?.width ?? pageDimensions[0].width;
      setZoom(availableWidth / pageWidth);
    }, [pageDimensions, currentPage]);

    const handleFitPage = useCallback(() => {
      const container = viewerContainerRef.current;
      if (!container || pageDimensions.length === 0) return;
      const availableWidth = container.clientWidth - FIT_ZOOM_PADDING;
      const availableHeight = container.clientHeight - FIT_ZOOM_PADDING;
      const dim = pageDimensions[currentPage - 1] ?? pageDimensions[0];
      const fitW = availableWidth / dim.width;
      const fitH = availableHeight / dim.height;
      setZoom(Math.min(fitW, fitH));
    }, [pageDimensions, currentPage]);

    const handleCurrentPageChange = useCallback((page: number) => {
      setCurrentPage(page);
    }, []);

    // Expose imperative handle for App.tsx to call
    useImperativeHandle(
      ref,
      () => ({
        save: () => {
          if (isMerging) {
            handleSaveMerged();
          } else {
            handleSave();
          }
        },
        saveAs: () => handleSaveAs(),
        print: () => handlePrint(),
        openFile: () => {
          openFile();
        },
        openPath: (path: string) => {
          openPath(path);
        },
        closeFile: () => handleCloseFile(),
        saveMerged: () => handleSaveMerged(),
        saveLocked: () => handleSaveLocked(),
        merge: () => handleAddDocument(),
        toggleSidebar: () => setSidebarOpen((s) => !s),
        toggleGallery: () => setViewMode((m) => (m === "scroll" ? "gallery" : "scroll")),
        zoomIn: () => setZoom((z) => Math.min(100, z * 1.25)),
        zoomOut: () => setZoom((z) => Math.max(0.1, z / 1.25)),
        zoomReset: () => setZoom(1),
        fitWidth: () => handleFitWidth(),
        fitPage: () => handleFitPage(),
        find: () => setSearchOpen((s) => !s),
      }),
      [handleSave, handleSaveAs, handleSaveLocked, handlePrint, openFile, openPath, handleCloseFile, handleSaveMerged, handleAddDocument, handleFitWidth, handleFitPage, isMerging]
    );

    const displayError = error || docError;

    return (
      <div
        className="document-view"
        style={{ display: isActive ? "flex" : "none" }}
      >
        <Toolbar
          fileName={fileName}
          currentPage={currentPage}
          totalPages={totalPages}
          zoom={zoom}
          loading={loading}
          sidebarOpen={sidebarOpen}
          activeTool={activeTool}
          hasUnsavedChanges={hasChanges || hasFormChanges}
          viewMode={viewMode}
          isMerging={isMerging}
          onOpen={handleOpen}
          onPrevPage={handlePrevPage}
          onNextPage={handleNextPage}
          onZoomChange={setZoom}
          onFitWidth={handleFitWidth}
          onFitPage={handleFitPage}
          onToggleSidebar={() => setSidebarOpen((s) => !s)}
          onToggleGallery={handleToggleGallery}
          onToolChange={handleToolChange}
          onSave={handleSave}
          onSaveAs={handleSaveAs}
          onSaveLocked={handleSaveLocked}
          onPrint={handlePrint}
          onAddDocument={handleAddDocument}
          onSaveMerged={handleSaveMerged}
          onExitMerge={handleExitMerge}
          onSignatureClick={handleSignatureClick}
          onGoToPage={handleGoToPage}
          onApplyRedactions={handleApplyRedactions}
          hasRedactions={annotations.some((a) => a.type === "redaction")}
          onToggleBookmarks={handleToggleBookmarks}
          bookmarksOpen={bookmarksOpen}
          onExportPages={() => setExportDialogOpen(true)}
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

          {loading && !pdfDoc ? (
            <div className="loading-state">
              <div className="spinner" />
              Opening…
            </div>
          ) : pdfDoc && pageDimensions.length > 0 ? (
            <div className="content-body">
              {viewMode === "gallery" || isMerging ? (
                <PageGallery
                  pdfDoc={pdfDoc}
                  pageDimensions={pageDimensions}
                  onPageClick={handleGalleryPageClick}
                  onDeletePage={isMerging ? undefined : handleDeletePage}
                  getPageAnnotations={isMerging ? undefined : getPageAnnotations}
                  onReorderPage={isMerging ? undefined : handleReorderPage}
                  onReorderPages={isMerging ? undefined : handleReorderPages}
                  onRotatePage={isMerging ? undefined : handleRotatePage}
                  onExtractPages={isMerging ? undefined : handleExtractPages}
                  onSplitPdf={isMerging ? undefined : handleSplitPdf}
                  onInsertBlankPage={isMerging ? undefined : handleInsertBlankPage}
                  onInsertImagePage={isMerging ? undefined : handleInsertImagePage}
                  pendingSelectionRef={galleryPendingSelectionRef}
                  mergePages={isMerging ? mergePages : undefined}
                  isMerging={isMerging}
                  onMergeRemovePage={isMerging ? mergeRemovePage : undefined}
                  onMergeRemovePages={isMerging ? mergeRemovePages : undefined}
                  onMergeReorderPage={isMerging ? mergeReorderPage : undefined}
                  onMergeReorderPages={isMerging ? mergeReorderPages : undefined}
                  onAddDocument={isMerging ? mergeAddDocument : handleAddDocument}
                  isBookmarked={isMerging ? undefined : isBookmarked}
                  onToggleBookmark={isMerging ? undefined : toggleBookmark}
                />
              ) : (
                <>
                  {bookmarksOpen ? (
                    <>
                      <OutlineSidebar
                        outline={outline ?? []}
                        currentPage={currentPage}
                        onPageClick={handleThumbnailClick}
                        customBookmarks={customBookmarks}
                        onRemoveBookmark={removeBookmark}
                        onUpdateBookmarkLabel={updateBookmarkLabel}
                        width={sidebarWidth}
                      />
                      <div className="sidebar-resize-handle" onMouseDown={handleSidebarResizeStart} onDoubleClick={handleSidebarResetWidth} title="Drag to resize, double-click to reset" />
                    </>
                  ) : sidebarOpen ? (
                    <>
                      <ThumbnailSidebar
                        pdfDoc={pdfDoc}
                        pageDimensions={pageDimensions}
                        currentPage={currentPage}
                        getPageAnnotations={getPageAnnotations}
                        onPageClick={handleThumbnailClick}
                        onDeletePage={handleDeletePage}
                        onReorderPage={handleReorderPage}
                        onRotatePage={handleRotatePage}
                        onExtractPages={handleExtractPages}
                        onSplitPdf={handleSplitPdf}
                        onInsertBlankPage={handleInsertBlankPage}
                        onInsertImagePage={handleInsertImagePage}
                        isBookmarked={isBookmarked}
                        onToggleBookmark={toggleBookmark}
                        width={sidebarWidth}
                        thumbSize={sidebarThumbSize}
                      />
                      <div className="sidebar-resize-handle" onMouseDown={handleSidebarResizeStart} onDoubleClick={handleSidebarResetWidth} title="Drag to resize, double-click to reset" />
                    </>
                  ) : null}
                  <PdfViewer
                    pdfDoc={pdfDoc}
                    pageDimensions={pageDimensions}
                    zoom={zoom}
                    onZoomChange={setZoom}
                    onCurrentPageChange={handleCurrentPageChange}
                    scrollToPageRef={scrollToPageRef}
                    viewerContainerRef={viewerContainerRef}
                    activeTool={activeTool}
                    highlightColor={highlightColor}
                    strokeWidth={strokeWidth}
                    onAddAnnotation={handleAddAnnotation}
                    onUpdateAnnotation={update}
                    onDeleteAnnotation={remove}
                    onApplyRedaction={handleApplySingleRedaction}
                    getPageAnnotations={getPageAnnotations}
                    searchQuery={searchQuery}
                    searchMatches={searchMatches}
                    currentMatch={currentMatch}
                    pendingSignature={pendingSignature}
                    isBookmarked={isBookmarked}
                    onToggleBookmark={toggleBookmark}
                  />
                </>
              )}
            </div>
          ) : (
            <div className="empty-state">
              <div className="drop-zone">
                <p>Open or drop a PDF to get started</p>
                <button onClick={handleOpen}>Open PDF</button>
              </div>

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

        {signatureSavePrompt && createPortal(
          <div className="save-dialog-backdrop" onMouseDown={() => setSignatureSavePrompt(false)}>
            <div className="save-dialog" onMouseDown={(e) => e.stopPropagation()}>
              <div className="save-dialog-body">
                This document has signatures. How would you like to proceed?
              </div>
              <div className="save-dialog-actions">
                <button
                  className="save-dialog-btn"
                  onClick={() => setSignatureSavePrompt(false)}
                >
                  Cancel
                </button>
                <button
                  className="save-dialog-btn"
                  onClick={async () => {
                    setSignatureSavePrompt(false);
                    await doSave();
                  }}
                >
                  Save
                </button>
                <button
                  className="save-dialog-btn"
                  onClick={async () => {
                    setSignatureSavePrompt(false);
                    await handleSaveAs();
                  }}
                >
                  Save As…
                </button>
                <button
                  className="save-dialog-btn save-dialog-save"
                  onClick={async () => {
                    setSignatureSavePrompt(false);
                    await handleSaveLocked();
                  }}
                  autoFocus
                >
                  Save Flattened…
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        {redactionSavePrompt && createPortal(
          <div className="save-dialog-backdrop" onMouseDown={() => setRedactionSavePrompt(false)}>
            <div className="save-dialog" onMouseDown={(e) => e.stopPropagation()}>
              <div className="save-dialog-body">
                This document has pending redactions. Applying redactions will permanently and irreversibly cover the marked areas with black — the content underneath cannot be recovered.
              </div>
              <div className="save-dialog-actions">
                <button
                  className="save-dialog-btn"
                  style={{ backgroundColor: "rgb(220, 38, 38)", color: "white" }}
                  onClick={async () => {
                    setRedactionSavePrompt(false);
                    await doSave();
                    if (metadata?.path) {
                      await invoke("apply_redactions", { path: metadata.path });
                      await openPath(metadata.path);
                    }
                  }}
                >
                  Apply Redactions
                </button>
                <button
                  className="save-dialog-btn save-dialog-save"
                  onClick={async () => {
                    setRedactionSavePrompt(false);
                    await doSave();
                  }}
                  autoFocus
                >
                  Save as Annotations
                </button>
                <button
                  className="save-dialog-btn"
                  onClick={() => setRedactionSavePrompt(false)}
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

        <SignatureModal
          open={signatureModalOpen}
          kind={signatureKind}
          savedSignatures={savedSignatures}
          onApply={handleSignatureApply}
          onSave={saveSig}
          onDeleteSaved={deleteSavedSig}
          onClose={handleSignatureModalClose}
          onChangeKind={setSignatureKind}
        />

        {exportDialogOpen && pdfDoc && (
          <ExportDialog
            pdfDoc={pdfDoc}
            totalPages={totalPages}
            currentPage={currentPage}
            onClose={() => setExportDialogOpen(false)}
          />
        )}
      </div>
    );
  }
);
