import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { ask } from "@tauri-apps/plugin-dialog";

interface Stroke {
  points: { x: number; y: number }[];
}

const FONTS = [
  { name: "Dancing Script", family: "'Dancing Script', cursive" },
  { name: "Great Vibes", family: "'Great Vibes', cursive" },
  { name: "Caveat", family: "'Caveat', cursive" },
  { name: "Brush Script", family: "'Brush Script MT', 'Snell Roundhand', 'Bradley Hand', cursive" },
  { name: "Snell Roundhand", family: "'Snell Roundhand', 'Segoe Script', cursive" },
  { name: "Lucida Handwriting", family: "'Lucida Handwriting', 'Apple Chancery', cursive" },
];

export type SignatureKind = "signature" | "initials";

interface SavedSig {
  id: string;
  name: string;
  imageData: string;
  kind?: SignatureKind;
}

interface SignatureModalProps {
  open: boolean;
  kind: SignatureKind;
  savedSignatures: SavedSig[];
  onApply: (imageData: string) => void;
  onSave: (name: string, imageData: string, kind: SignatureKind) => void;
  onDeleteSaved: (id: string) => void;
  onClose: () => void;
  onChangeKind: (kind: SignatureKind) => void;
}

export function SignatureModal({
  open,
  kind,
  savedSignatures,
  onApply,
  onSave,
  onDeleteSaved,
  onClose,
  onChangeKind,
}: SignatureModalProps) {
  const [tab, setTab] = useState<"draw" | "type" | "saved">("draw");

  // Draw tab state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const drawingRef = useRef(false);
  const currentStroke = useRef<{ x: number; y: number }[]>([]);

  // Type tab state
  const [typedName, setTypedName] = useState("");
  const [selectedFont, setSelectedFont] = useState(0);

  // Filter saved signatures by kind
  const filteredSaved = savedSignatures.filter(
    (s) => (s.kind ?? "signature") === kind
  );

  // Redraw canvas when strokes change
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x, stroke.points[0].y);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x, stroke.points[i].y);
      }
      ctx.stroke();
    }
  }, [strokes]);

  const getCanvasPoint = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) * (canvas.width / rect.width),
        y: (e.clientY - rect.top) * (canvas.height / rect.height),
      };
    },
    []
  );

  const handleDrawStart = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      drawingRef.current = true;
      const pt = getCanvasPoint(e);
      currentStroke.current = [pt];

      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
    },
    [getCanvasPoint]
  );

  const handleDrawMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      if (!drawingRef.current) return;
      const pt = getCanvasPoint(e);
      currentStroke.current.push(pt);

      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      ctx.lineTo(pt.x, pt.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pt.x, pt.y);
    },
    [getCanvasPoint]
  );

  const handleDrawEnd = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const points = [...currentStroke.current];
    currentStroke.current = [];
    if (points.length > 1) {
      setStrokes((prev) => [...prev, { points }]);
    }
  }, []);

  const handleClear = useCallback(() => {
    setStrokes([]);
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext("2d")!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }, []);

  const handleUndoStroke = useCallback(() => {
    setStrokes((prev) => prev.slice(0, -1));
  }, []);

  const exportDrawing = useCallback((): string | null => {
    const canvas = canvasRef.current;
    if (!canvas || strokes.length === 0) return null;

    // Find bounding box of all strokes
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const stroke of strokes) {
      for (const pt of stroke.points) {
        minX = Math.min(minX, pt.x);
        minY = Math.min(minY, pt.y);
        maxX = Math.max(maxX, pt.x);
        maxY = Math.max(maxY, pt.y);
      }
    }

    const pad = 10;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(canvas.width, maxX + pad);
    maxY = Math.min(canvas.height, maxY + pad);

    const w = maxX - minX;
    const h = maxY - minY;
    if (w < 5 || h < 5) return null;

    // Render to new canvas with white background
    const outCanvas = document.createElement("canvas");
    outCanvas.width = w;
    outCanvas.height = h;
    const ctx = outCanvas.getContext("2d")!;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(stroke.points[0].x - minX, stroke.points[0].y - minY);
      for (let i = 1; i < stroke.points.length; i++) {
        ctx.lineTo(stroke.points[i].x - minX, stroke.points[i].y - minY);
      }
      ctx.stroke();
    }
    return outCanvas.toDataURL("image/jpeg", 0.95);
  }, [strokes]);

  const exportTyped = useCallback((): string | null => {
    if (!typedName.trim()) return null;
    const displayText = typedName.trim();

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d")!;
    const font = FONTS[selectedFont];

    // Fixed canvas size so all typed signatures are consistent
    const W = 400;
    const H = 80;
    const padding = 16;
    canvas.width = W;
    canvas.height = H;

    // Find the largest font size that fits within the canvas
    let fontSize = 60;
    const minFontSize = 16;
    ctx.font = `${fontSize}px ${font.family}`;
    let metrics = ctx.measureText(displayText);
    while (metrics.width > W - padding * 2 && fontSize > minFontSize) {
      fontSize -= 2;
      ctx.font = `${fontSize}px ${font.family}`;
      metrics = ctx.measureText(displayText);
    }

    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#000";
    ctx.font = `${fontSize}px ${font.family}`;
    ctx.textBaseline = "middle";
    ctx.fillText(displayText, padding, H / 2);

    return canvas.toDataURL("image/jpeg", 0.95);
  }, [typedName, selectedFont]);

  const handleApply = useCallback(async () => {
    let imageData: string | null = null;
    let name = "";
    if (tab === "draw") {
      imageData = exportDrawing();
      name = kind === "initials" ? "Drawn initials" : "Drawn signature";
    } else if (tab === "type") {
      imageData = exportTyped();
      name = typedName || (kind === "initials" ? "Typed initials" : "Typed signature");
    }
    if (!imageData) return;

    const label = kind === "initials" ? "these initials" : "this signature";
    const shouldSave = await ask(
      `Save ${label} for future use?`,
      {
        title: "Save",
        kind: "info",
        okLabel: "Save & Apply",
        cancelLabel: "Just Apply",
      }
    );
    if (shouldSave) {
      onSave(name, imageData, kind);
    }
    onApply(imageData);
  }, [tab, exportDrawing, exportTyped, typedName, kind, onApply, onSave]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const kindLabel = kind === "initials" ? "Initials" : "Signature";
  const typePreview = typedName || kindLabel;

  return createPortal(
    <div className="signature-modal-backdrop" onMouseDown={onClose}>
      <div
        className="signature-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="signature-modal-header">
          <h3>Add {kindLabel}</h3>
          <button className="signature-modal-close" onClick={onClose}>
            &times;
          </button>
        </div>

        <div className="signature-kind-toggle">
          <button
            className={kind === "signature" ? "kind-active" : ""}
            onClick={() => onChangeKind("signature")}
          >
            Signature
          </button>
          <button
            className={kind === "initials" ? "kind-active" : ""}
            onClick={() => onChangeKind("initials")}
          >
            Initials
          </button>
        </div>

        <div className="signature-tabs">
          <button
            className={tab === "draw" ? "signature-tab-active" : ""}
            onClick={() => setTab("draw")}
          >
            Draw
          </button>
          <button
            className={tab === "type" ? "signature-tab-active" : ""}
            onClick={() => setTab("type")}
          >
            Type
          </button>
          <button
            className={tab === "saved" ? "signature-tab-active" : ""}
            onClick={() => setTab("saved")}
          >
            Saved ({filteredSaved.length})
          </button>
        </div>

        <div className="signature-modal-body">
          {tab === "draw" && (
            <div className="signature-draw-tab">
              <canvas
                ref={canvasRef}
                width={500}
                height={200}
                className="signature-canvas"
                onMouseDown={handleDrawStart}
                onMouseMove={handleDrawMove}
                onMouseUp={handleDrawEnd}
                onMouseLeave={handleDrawEnd}
              />
              <div className="signature-draw-actions">
                <button onClick={handleUndoStroke} disabled={strokes.length === 0}>
                  Undo
                </button>
                <button onClick={handleClear} disabled={strokes.length === 0}>
                  Clear
                </button>
              </div>
            </div>
          )}

          {tab === "type" && (
            <div className="signature-type-tab">
              <input
                type="text"
                className="signature-type-input"
                value={kind === "initials" ? typedName.slice(0, 4) : typedName}
                maxLength={kind === "initials" ? 4 : 40}
                onChange={(e) => {
                  const v = e.target.value;
                  setTypedName(kind === "initials" ? v.slice(0, 4) : v.slice(0, 40));
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleApply();
                }}
                placeholder={kind === "initials" ? "Type your initials" : "Type your name"}
                autoFocus
              />
              <div className="signature-font-picker">
                {FONTS.map((font, i) => (
                  <button
                    key={font.name}
                    className={i === selectedFont ? "signature-font-active" : ""}
                    onClick={() => setSelectedFont(i)}
                    style={{ fontFamily: font.family }}
                  >
                    {kind === "initials" ? (typePreview).slice(0, 4) : typePreview}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === "saved" && (
            <div className="signature-saved-tab">
              {filteredSaved.length === 0 ? (
                <p className="signature-saved-empty">
                  No saved {kind === "initials" ? "initials" : "signatures"}. Create one in the Draw or Type tab.
                </p>
              ) : (
                <div className="signature-saved-grid">
                  {filteredSaved.map((sig) => (
                    <div key={sig.id} className="signature-saved-item">
                      <img
                        src={sig.imageData}
                        alt={sig.name}
                        onClick={() => onApply(sig.imageData)}
                      />
                      <button
                        className="signature-saved-delete"
                        onClick={() => onDeleteSaved(sig.id)}
                      >
                        &times;
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {tab !== "saved" && (
          <div className="signature-modal-footer">
            <button onClick={handleApply} className="signature-btn-primary">
              Apply
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
