import { useState, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { save, open } from "@tauri-apps/plugin-dialog";
import type { PdfDocument } from "../lib/pdf/types";

interface ExportDialogProps {
  pdfDoc: PdfDocument;
  totalPages: number;
  currentPage: number;
  onClose: () => void;
}

type PageSelection = "current" | "all" | "custom";
type ImageFormat = "png" | "jpeg";

function parsePageRange(input: string, totalPages: number): number[] {
  const pages = new Set<number>();
  for (const part of input.split(",")) {
    const trimmed = part.trim();
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = Math.max(1, parseInt(rangeMatch[1], 10));
      const end = Math.min(totalPages, parseInt(rangeMatch[2], 10));
      for (let i = start; i <= end; i++) pages.add(i);
    } else {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 1 && num <= totalPages) pages.add(num);
    }
  }
  return Array.from(pages).sort((a, b) => a - b);
}

export function ExportDialog({
  pdfDoc,
  totalPages,
  currentPage,
  onClose,
}: ExportDialogProps) {
  const [pageSelection, setPageSelection] = useState<PageSelection>("current");
  const [customRange, setCustomRange] = useState("");
  const [format, setFormat] = useState<ImageFormat>("png");
  const [quality, setQuality] = useState(90);
  const [scale, setScale] = useState(2);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });

  const getPages = useCallback((): number[] => {
    switch (pageSelection) {
      case "current":
        return [currentPage];
      case "all":
        return Array.from({ length: totalPages }, (_, i) => i + 1);
      case "custom":
        return parsePageRange(customRange, totalPages);
    }
  }, [pageSelection, currentPage, totalPages, customRange]);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && !exporting) {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [exporting, onClose]);

  const handleExport = useCallback(async () => {
    const pages = getPages();
    if (pages.length === 0) return;

    setExporting(true);
    setProgress({ current: 0, total: pages.length });

    try {
      const ext = format === "png" ? "png" : "jpg";
      const mimeType = format === "png" ? "image/png" : "image/jpeg";

      if (pages.length === 1) {
        // Single page: save dialog
        const dest = await save({
          title: "Export Page as Image",
          filters: [{ name: format.toUpperCase(), extensions: [ext] }],
        });
        if (!dest) {
          setExporting(false);
          return;
        }

        const dataUrl = await renderPageToBase64(
          pdfDoc, pages[0], scale, mimeType, quality / 100
        );
        await invoke("export_page_image", { path: dest, imageData: dataUrl });
        setProgress({ current: 1, total: 1 });
      } else {
        // Multiple pages: folder picker
        const folder = await open({ directory: true, title: "Select Export Folder" });
        if (!folder) {
          setExporting(false);
          return;
        }

        for (let i = 0; i < pages.length; i++) {
          const pageNum = pages[i];
          const fileName = `Page${pageNum}.${ext}`;
          const filePath = `${folder}/${fileName}`;

          const dataUrl = await renderPageToBase64(
            pdfDoc, pageNum, scale, mimeType, quality / 100
          );
          await invoke("export_page_image", { path: filePath, imageData: dataUrl });
          setProgress({ current: i + 1, total: pages.length });
        }
      }

      onClose();
    } catch (err) {
      console.error("Export failed:", err);
    } finally {
      setExporting(false);
    }
  }, [getPages, format, quality, scale, pdfDoc, onClose]);

  const pageCount = getPages().length;

  return createPortal(
    <div className="save-dialog-backdrop" onMouseDown={exporting ? undefined : onClose}>
      <div className="save-dialog export-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3 style={{ margin: "0 0 12px", fontSize: 16 }}>Export as Images</h3>

        <div className="export-field">
          <label className="export-label">Pages</label>
          <div className="export-options-row">
            <label className="export-radio">
              <input
                type="radio"
                checked={pageSelection === "current"}
                onChange={() => setPageSelection("current")}
                disabled={exporting}
              />
              Current ({currentPage})
            </label>
            <label className="export-radio">
              <input
                type="radio"
                checked={pageSelection === "all"}
                onChange={() => setPageSelection("all")}
                disabled={exporting}
              />
              All ({totalPages})
            </label>
            <label className="export-radio">
              <input
                type="radio"
                checked={pageSelection === "custom"}
                onChange={() => setPageSelection("custom")}
                disabled={exporting}
              />
              Custom
            </label>
          </div>
          {pageSelection === "custom" && (
            <input
              className="export-range-input"
              type="text"
              placeholder="e.g. 1-5, 8"
              value={customRange}
              onChange={(e) => setCustomRange(e.target.value)}
              disabled={exporting}
              autoFocus
            />
          )}
        </div>

        <div className="export-field">
          <label className="export-label">Format</label>
          <div className="export-options-row">
            <label className="export-radio">
              <input
                type="radio"
                checked={format === "png"}
                onChange={() => setFormat("png")}
                disabled={exporting}
              />
              PNG
            </label>
            <label className="export-radio">
              <input
                type="radio"
                checked={format === "jpeg"}
                onChange={() => setFormat("jpeg")}
                disabled={exporting}
              />
              JPEG
            </label>
          </div>
        </div>

        {format === "jpeg" && (
          <div className="export-field">
            <label className="export-label">Quality: {quality}%</label>
            <input
              type="range"
              min={1}
              max={100}
              value={quality}
              onChange={(e) => setQuality(parseInt(e.target.value, 10))}
              disabled={exporting}
              style={{ width: "100%" }}
            />
          </div>
        )}

        <div className="export-field">
          <label className="export-label">Scale</label>
          <select
            value={scale}
            onChange={(e) => setScale(parseInt(e.target.value, 10))}
            disabled={exporting}
            className="export-select"
          >
            <option value={1}>1x (72 DPI)</option>
            <option value={2}>2x (144 DPI)</option>
            <option value={3}>3x (216 DPI)</option>
          </select>
        </div>

        {exporting && progress.total > 0 && (
          <div className="export-progress">
            <div
              className="export-progress-bar"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
            <span className="export-progress-text">
              {progress.current} / {progress.total}
            </span>
          </div>
        )}

        <div className="save-dialog-actions">
          <button
            className="save-dialog-btn"
            onClick={onClose}
            disabled={exporting}
          >
            Cancel
          </button>
          <button
            className="save-dialog-btn save-dialog-save"
            onClick={handleExport}
            disabled={exporting || pageCount === 0}
          >
            {exporting ? "Exporting…" : `Export ${pageCount} page${pageCount !== 1 ? "s" : ""}`}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

async function renderPageToBase64(
  pdfDoc: PdfDocument,
  pageNumber: number,
  scale: number,
  mimeType: string,
  quality: number
): Promise<string> {
  const page = await pdfDoc.getPage(pageNumber);
  const viewport = page.getViewport(scale);
  const canvas = document.createElement("canvas");
  const task = page.renderToCanvas(canvas, viewport);
  await task.promise;

  return new Promise<string>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error("Failed to create blob"));
        const reader = new FileReader();
        reader.onload = () => {
          // Strip data URL prefix, return raw base64
          const dataUrl = reader.result as string;
          const base64 = dataUrl.split(",")[1];
          resolve(base64);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      },
      mimeType,
      quality
    );
  });
}
