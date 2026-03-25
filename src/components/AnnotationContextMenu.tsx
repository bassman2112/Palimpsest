import { forwardRef, useCallback } from "react";
import type { Annotation } from "../types";
import { HIGHLIGHT_COLORS } from "../constants";

interface ContextMenuState {
  x: number;
  y: number;
  annotationId: string;
  annotationType: string;
}

interface AnnotationContextMenuProps {
  contextMenu: ContextMenuState;
  annotations: Annotation[];
  onUpdateAnnotation: (id: string, updates: Partial<Annotation>) => void;
  onDeleteAnnotation: (id: string) => void;
  onClose: () => void;
}

export const AnnotationContextMenu = forwardRef<HTMLDivElement, AnnotationContextMenuProps>(
  function AnnotationContextMenu(
    { contextMenu, annotations, onUpdateAnnotation, onDeleteAnnotation, onClose },
    ref,
  ) {
    const handleRecolor = useCallback(
      (color: string) => {
        onUpdateAnnotation(contextMenu.annotationId, { color });
        onClose();
      },
      [contextMenu.annotationId, onUpdateAnnotation, onClose],
    );

    const handleDelete = useCallback(() => {
      onDeleteAnnotation(contextMenu.annotationId);
      onClose();
    }, [contextMenu.annotationId, onDeleteAnnotation, onClose]);

    const ann = annotations.find((a) => a.id === contextMenu.annotationId);
    const textAnn = ann?.type === "text" ? ann : null;

    return (
      <div
        ref={ref}
        className="annotation-context-menu"
        style={{
          position: "fixed",
          left: contextMenu.x,
          top: contextMenu.y,
        }}
      >
        {(contextMenu.annotationType === "highlight" ||
          contextMenu.annotationType === "underline" ||
          contextMenu.annotationType === "strikethrough" ||
          contextMenu.annotationType === "ink" ||
          contextMenu.annotationType === "shape" ||
          contextMenu.annotationType === "text") && (
          <div className="annotation-color-swatches">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.color}
                className="annotation-color-swatch"
                style={{ backgroundColor: c.color }}
                title={c.label}
                onClick={() => handleRecolor(c.color)}
              />
            ))}
            {contextMenu.annotationType === "text" && (
              <button
                className="annotation-color-swatch"
                style={{ backgroundColor: "#000000" }}
                title="Black"
                onClick={() => handleRecolor("#000000")}
              />
            )}
          </div>
        )}
        {contextMenu.annotationType === "text" && (
          <>
            <div className="annotation-font-sizes">
              {[10, 12, 14, 18, 24, 36].map((s) => (
                <button
                  key={s}
                  className={`annotation-font-size-btn${textAnn?.fontSize === s ? " active" : ""}`}
                  onClick={() => {
                    onUpdateAnnotation(contextMenu.annotationId, { fontSize: s } as Partial<Annotation>);
                    onClose();
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
            <div className="annotation-font-toggles">
              <button
                className={`annotation-font-toggle-btn${textAnn?.bold ? " active" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const active = document.activeElement;
                  const isEditing = active?.getAttribute("contenteditable") === "true"
                    && active.closest(".text-annotation");
                  if (isEditing && window.getSelection()?.toString()) {
                    document.execCommand("bold");
                  } else {
                    onUpdateAnnotation(contextMenu.annotationId, { bold: !textAnn?.bold } as Partial<Annotation>);
                  }
                  onClose();
                }}
              >
                <b>B</b>
              </button>
              <button
                className={`annotation-font-toggle-btn${textAnn?.italic ? " active" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const active = document.activeElement;
                  const isEditing = active?.getAttribute("contenteditable") === "true"
                    && active.closest(".text-annotation");
                  if (isEditing && window.getSelection()?.toString()) {
                    document.execCommand("italic");
                  } else {
                    onUpdateAnnotation(contextMenu.annotationId, { italic: !textAnn?.italic } as Partial<Annotation>);
                  }
                  onClose();
                }}
              >
                <i>I</i>
              </button>
              <button
                className={`annotation-font-toggle-btn${textAnn?.underline ? " active" : ""}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  const active = document.activeElement;
                  const isEditing = active?.getAttribute("contenteditable") === "true"
                    && active.closest(".text-annotation");
                  if (isEditing && window.getSelection()?.toString()) {
                    document.execCommand("underline");
                  } else {
                    onUpdateAnnotation(contextMenu.annotationId, { underline: !textAnn?.underline } as Partial<Annotation>);
                  }
                  onClose();
                }}
              >
                <span style={{ textDecoration: "underline" }}>U</span>
              </button>
            </div>
            <div className="annotation-font-families">
              {([["sans-serif", "Sans-serif"], ["serif", "Serif"], ["monospace", "Monospace"]] as const).map(([val, label]) => (
                <button
                  key={val}
                  className={`annotation-font-family-btn${textAnn?.fontFamily === val ? " active" : ""}`}
                  onClick={() => {
                    onUpdateAnnotation(contextMenu.annotationId, { fontFamily: val } as Partial<Annotation>);
                    onClose();
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="annotation-bg-colors">
              <span className="annotation-bg-label">Background</span>
              {[
                { value: "transparent", label: "None", css: "transparent" },
                { value: "rgba(254, 240, 138, 0.5)", label: "Yellow", css: "#fef08a" },
                { value: "rgba(147, 197, 253, 0.5)", label: "Blue", css: "#93c5fd" },
                { value: "rgba(134, 239, 172, 0.5)", label: "Green", css: "#86efac" },
                { value: "rgba(252, 165, 165, 0.5)", label: "Red", css: "#fca5a5" },
                { value: "rgba(216, 180, 254, 0.5)", label: "Purple", css: "#d8b4fe" },
                { value: "rgba(253, 186, 116, 0.5)", label: "Orange", css: "#fdba74" },
              ].map((bg) => (
                <button
                  key={bg.value}
                  className={`annotation-bg-swatch${textAnn?.backgroundColor === bg.value ? " active" : ""}`}
                  style={{
                    backgroundColor: bg.css,
                    border: bg.value === "transparent" ? "2px solid #ccc" : "2px solid transparent",
                  }}
                  title={bg.label}
                  onClick={() => {
                    onUpdateAnnotation(contextMenu.annotationId, { backgroundColor: bg.value } as Partial<Annotation>);
                    onClose();
                  }}
                />
              ))}
            </div>
          </>
        )}
        {(contextMenu.annotationType === "shape" || contextMenu.annotationType === "ink") && (
          <div className="annotation-stroke-widths">
            {[1, 2, 3, 5, 8].map((w) => (
              <button
                key={w}
                className="annotation-stroke-option"
                title={`${w}px`}
                onClick={() => {
                  onUpdateAnnotation(contextMenu.annotationId, { strokeWidth: w } as Partial<Annotation>);
                  onClose();
                }}
              >
                <svg width="32" height="16" viewBox="0 0 32 16">
                  <line x1="4" y1="8" x2="28" y2="8" stroke="currentColor" strokeWidth={w} strokeLinecap="round" />
                </svg>
              </button>
            ))}
          </div>
        )}
        <button className="annotation-context-delete" onClick={handleDelete}>
          Delete
        </button>
      </div>
    );
  },
);
