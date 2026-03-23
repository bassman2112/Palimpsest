import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./services/pdfWorkerSetup";
import { useRecentFiles } from "./hooks/useRecentFiles";
import { TabBar } from "./components/TabBar";
import type { Tab, TabColor } from "./components/TabBar";
import { DocumentView } from "./components/DocumentView";
import type { DocumentViewHandle } from "./components/DocumentView";
import { SaveDialog } from "./components/SaveDialog";
import type { SaveDialogResult } from "./components/SaveDialog";
import "./App.css";

function createTab(): Tab {
  return { id: crypto.randomUUID(), title: "New Tab", hasChanges: false, color: null };
}

type ThemeMode = "auto" | "light" | "dark";

function getStoredTheme(): ThemeMode {
  return (localStorage.getItem("palimpsest-theme") as ThemeMode) || "auto";
}

function applyTheme(mode: ThemeMode) {
  const theme = mode === "auto" ? null : mode;
  getCurrentWindow().setTheme(theme).catch(() => {});
}

function App() {
  const [tabs, setTabs] = useState<Tab[]>(() => [createTab()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [themeMode, setThemeMode] = useState<ThemeMode>(getStoredTheme);
  const { recentFiles, addRecent } = useRecentFiles();
  const tabRefs = useRef<Map<string, DocumentViewHandle>>(new Map());
  const [closePrompt, setClosePrompt] = useState<{ id: string; title: string } | null>(null);

  useEffect(() => {
    applyTheme(themeMode);
    localStorage.setItem("palimpsest-theme", themeMode);
  }, [themeMode]);

  const cycleTheme = useCallback(() => {
    setThemeMode((prev) => {
      if (prev === "auto") return "light";
      if (prev === "light") return "dark";
      return "auto";
    });
  }, []);

  // Keep refs in sync so event listeners never see stale values
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Sync recent files to native menu
  useEffect(() => {
    invoke("update_recent_files", {
      paths: recentFiles.map((f) => f.path),
    }).catch(() => {});
  }, [recentFiles]);

  const handleNewTab = useCallback(() => {
    const tab = createTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, []);

  const doCloseTab = useCallback((id: string) => {
    const currentTabs = tabsRef.current;
    const currentActive = activeTabIdRef.current;

    if (currentTabs.length === 1) {
      const fresh = createTab();
      setTabs([fresh]);
      setActiveTabId(fresh.id);
    } else {
      const idx = currentTabs.findIndex((t) => t.id === id);
      const next = currentTabs.filter((t) => t.id !== id);
      setTabs(next);
      if (id === currentActive) {
        const newIdx = Math.min(idx, next.length - 1);
        setActiveTabId(next[newIdx].id);
      }
    }
    tabRefs.current.delete(id);
  }, []);

  const handleCloseTab = useCallback(
    (id: string) => {
      const tab = tabsRef.current.find((t) => t.id === id);
      if (tab?.hasChanges) {
        setClosePrompt({ id, title: tab.title });
        return;
      }
      doCloseTab(id);
    },
    [doCloseTab]
  );

  const handleClosePromptResult = useCallback(
    (result: SaveDialogResult) => {
      if (!closePrompt) return;
      const { id } = closePrompt;
      setClosePrompt(null);
      if (result === "cancel") return;
      if (result === "save") {
        tabRefs.current.get(id)?.save();
      }
      doCloseTab(id);
    },
    [closePrompt, doCloseTab]
  );

  const handleSelectTab = useCallback((id: string) => {
    setActiveTabId(id);
  }, []);

  const handleTabInfoChange = useCallback(
    (tabId: string, info: { title: string; hasChanges: boolean }) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId ? { ...t, title: info.title, hasChanges: info.hasChanges } : t
        )
      );
    },
    []
  );

  const handleSetTabColor = useCallback((id: string, color: TabColor) => {
    setTabs((prev) => prev.map((t) => (t.id === id ? { ...t, color } : t)));
  }, []);

  // Listen for native menu events — route to active tab via refs (stable, no stale closures)
  useEffect(() => {
    const unlistenOpen = listen<void>("menu-open-file", () => {
      tabRefs.current.get(activeTabIdRef.current)?.openFile();
    });
    const unlistenRecent = listen<string>("menu-open-recent", (event) => {
      tabRefs.current.get(activeTabIdRef.current)?.openPath(event.payload);
    });
    const unlistenSave = listen<void>("menu-save", () => {
      tabRefs.current.get(activeTabIdRef.current)?.save();
    });
    const unlistenSaveAs = listen<void>("menu-save-as", () => {
      tabRefs.current.get(activeTabIdRef.current)?.saveAs();
    });
    const unlistenPrint = listen<void>("menu-print", () => {
      tabRefs.current.get(activeTabIdRef.current)?.print();
    });
    const unlistenCloseFile = listen<void>("menu-close-file", () => {
      handleCloseTab(activeTabIdRef.current);
    });
    const unlistenNewTab = listen<void>("menu-new-tab", () => {
      handleNewTab();
    });
    return () => {
      unlistenOpen.then((f) => f());
      unlistenRecent.then((f) => f());
      unlistenSave.then((f) => f());
      unlistenSaveAs.then((f) => f());
      unlistenPrint.then((f) => f());
      unlistenCloseFile.then((f) => f());
      unlistenNewTab.then((f) => f());
    };
  }, [handleCloseTab, handleNewTab]);

  // Global keyboard shortcut: Cmd+T (new tab)
  // Note: Cmd+W is handled by the native menu (menu-close-file event)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "t") {
        e.preventDefault();
        handleNewTab();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleNewTab]);

  return (
    <div className="app">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onNewTab={handleNewTab}
        onSetTabColor={handleSetTabColor}
        themeMode={themeMode}
        onCycleTheme={cycleTheme}
      />
      {tabs.map((tab) => (
        <DocumentView
          key={tab.id}
          ref={(handle) => {
            if (handle) {
              tabRefs.current.set(tab.id, handle);
            } else {
              tabRefs.current.delete(tab.id);
            }
          }}
          isActive={tab.id === activeTabId}
          recentFiles={recentFiles}
          onAddRecent={addRecent}
          onTabInfoChange={(info) => handleTabInfoChange(tab.id, info)}
        />
      ))}
      {closePrompt && (
        <SaveDialog
          title={closePrompt.title}
          onResult={handleClosePromptResult}
        />
      )}
    </div>
  );
}

export default App;
