import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export const TAB_COLORS = [
  { name: "Default", value: null },
  { name: "Red", value: "#e74c3c" },
  { name: "Orange", value: "#e67e22" },
  { name: "Green", value: "#27ae60" },
  { name: "Blue", value: "#2980b9" },
  { name: "Purple", value: "#8e44ad" },
  { name: "Pink", value: "#e84393" },
] as const;

export type TabColor = (typeof TAB_COLORS)[number]["value"];

export interface Tab {
  id: string;
  title: string;
  hasChanges: boolean;
  color: TabColor;
}

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onNewTab: () => void;
  onSetTabColor: (id: string, color: TabColor) => void;
  themeMode?: "auto" | "light" | "dark";
  onCycleTheme?: () => void;
}

export function TabBar({
  tabs,
  activeTabId,
  onSelectTab,
  onCloseTab,
  onNewTab,
  onSetTabColor,
  themeMode,
  onCycleTheme,
}: TabBarProps) {
  const [contextMenu, setContextMenu] = useState<{ tabId: string; x: number; y: number } | null>(
    null
  );
  const menuRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, tabId: string) => {
    e.preventDefault();
    setContextMenu({ tabId, x: e.clientX, y: e.clientY });
  }, []);

  // Close context menu on outside click or Escape
  useEffect(() => {
    if (!contextMenu) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [contextMenu]);

  // Native mousedown listener for window dragging.
  // Clicking any non-interactive area of the tab bar starts a window drag.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    function onMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest(".tab, button, .tab-context-menu")) return;
      e.preventDefault();
      getCurrentWindow().startDragging();
    }
    bar.addEventListener("mousedown", onMouseDown);
    return () => bar.removeEventListener("mousedown", onMouseDown);
  }, []);

  return (
    <div className="tab-bar" ref={barRef}>
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        const colorStyle = tab.color
          ? { borderTop: `4px solid ${tab.color}`, paddingTop: "2px" }
          : {};
        return (
          <div
            key={tab.id}
            className={`tab${isActive ? " tab-active" : ""}`}
            style={colorStyle}
            onClick={() => onSelectTab(tab.id)}
            onContextMenu={(e) => handleContextMenu(e, tab.id)}
          >
            {tab.hasChanges && <span className="tab-unsaved" />}
            <span className="tab-title">{tab.title}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
            >
              &times;
            </button>
          </div>
        );
      })}
      <button className="tab-new" onClick={onNewTab}>
        +
      </button>
      <div className="tab-drag-spacer" />

      {onCycleTheme && (
        <button
          className="theme-toggle"
          onClick={onCycleTheme}
          data-tooltip={`Theme: ${themeMode ?? "auto"}`}
        >
          {themeMode === "dark" ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M13.5 8.5a5.5 5.5 0 1 1-6-6 4 4 0 0 0 6 6Z" />
            </svg>
          ) : themeMode === "light" ? (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="3" />
              <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" />
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="8" cy="8" r="5" />
              <path d="M8 3v10" />
              <path d="M8 3a5 5 0 0 1 0 10" fill="currentColor" />
            </svg>
          )}
        </button>
      )}

      {contextMenu && (
        <div
          ref={menuRef}
          className="tab-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <div className="tab-context-label">Tab Color</div>
          <div className="tab-color-list">
            {TAB_COLORS.map((c) => (
              <button
                key={c.name}
                className="tab-color-option"
                onClick={() => {
                  onSetTabColor(contextMenu.tabId, c.value);
                  setContextMenu(null);
                }}
              >
                <span
                  className="tab-color-swatch"
                  style={{
                    background: c.value ?? "#ccc",
                    border: c.value === null ? "2px solid #aaa" : "none",
                  }}
                />
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
