import { useEffect } from "react";
import { createPortal } from "react-dom";

export type SaveDialogResult = "save" | "discard" | "cancel";

interface SaveDialogProps {
  title: string;
  onResult: (result: SaveDialogResult) => void;
}

export function SaveDialog({ title, onResult }: SaveDialogProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onResult("cancel");
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onResult]);

  return createPortal(
    <div className="save-dialog-backdrop" onMouseDown={() => onResult("cancel")}>
      <div className="save-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="save-dialog-body">
          <strong>&ldquo;{title}&rdquo;</strong> has unsaved changes.
        </div>
        <div className="save-dialog-actions">
          <button
            className="save-dialog-btn save-dialog-save"
            onClick={() => onResult("save")}
            autoFocus
          >
            Save
          </button>
          <button
            className="save-dialog-btn save-dialog-discard"
            onClick={() => onResult("discard")}
          >
            Don&rsquo;t Save
          </button>
          <button
            className="save-dialog-btn save-dialog-cancel"
            onClick={() => onResult("cancel")}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
