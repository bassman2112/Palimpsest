import { useEffect } from "react";
import { createPortal } from "react-dom";

const isMac = navigator.platform.toUpperCase().includes("MAC");
const mod = isMac ? "\u2318" : "Ctrl+";
const shift = isMac ? "\u21E7" : "Shift+";

interface ShortcutRow {
  label: string;
  keys: string;
}

const sections: { title: string; shortcuts: ShortcutRow[] }[] = [
  {
    title: "File",
    shortcuts: [
      { label: "New Tab", keys: `${mod}T` },
      { label: "Open", keys: `${mod}O` },
      { label: "Close Tab", keys: `${mod}W` },
      { label: "Save", keys: `${mod}S` },
      { label: "Save As", keys: `${mod}${shift}S` },
      { label: "Print", keys: `${mod}P` },
    ],
  },
  {
    title: "Edit",
    shortcuts: [
      { label: "Undo", keys: `${mod}Z` },
      { label: "Redo", keys: `${mod}${shift}Z` },
      { label: "Cut", keys: `${mod}X` },
      { label: "Copy", keys: `${mod}C` },
      { label: "Paste", keys: `${mod}V` },
      { label: "Select All", keys: `${mod}A` },
    ],
  },
  {
    title: "View",
    shortcuts: [
      { label: "Toggle Sidebar", keys: `${mod}\\` },
      { label: "Zoom In", keys: `${mod}${shift}=` },
      { label: "Zoom Out", keys: `${mod}-` },
      { label: "Actual Size", keys: `${mod}0` },
      { label: "Find", keys: `${mod}F` },
      { label: "Keyboard Shortcuts", keys: `${mod}/` },
    ],
  },
  {
    title: "Text Editing",
    shortcuts: [
      { label: "Bold", keys: `${mod}B` },
      { label: "Italic", keys: `${mod}I` },
      { label: "Underline", keys: `${mod}U` },
    ],
  },
  {
    title: "Tools",
    shortcuts: [
      { label: "Deselect Tool", keys: "Escape" },
    ],
  },
];

interface KeyboardShortcutsProps {
  onClose: () => void;
}

export function KeyboardShortcuts({ onClose }: KeyboardShortcutsProps) {
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  return createPortal(
    <div className="save-dialog-backdrop" onMouseDown={onClose}>
      <div className="shortcuts-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="shortcuts-header">
          <h2>Keyboard Shortcuts</h2>
          <button className="shortcuts-close" onClick={onClose}>&times;</button>
        </div>
        <div className="shortcuts-body">
          {sections.map((section) => (
            <div key={section.title} className="shortcuts-section">
              <h3>{section.title}</h3>
              {section.shortcuts.map((s) => (
                <div key={s.label} className="shortcut-row">
                  <span>{s.label}</span>
                  <kbd>{s.keys}</kbd>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body
  );
}
