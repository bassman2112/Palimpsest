import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./lib/pdf";
import { useRecentFiles } from "./hooks/useRecentFiles";
import { TabBar } from "./components/TabBar";
import type { Tab, TabColor } from "./components/TabBar";
import { DocumentView } from "./components/DocumentView";
import type { DocumentViewHandle } from "./components/DocumentView";
import { SaveDialog } from "./components/SaveDialog";
import type { SaveDialogResult } from "./components/SaveDialog";
import { KeyboardShortcuts } from "./components/KeyboardShortcuts";
import { ErrorBoundary } from "./components/ErrorBoundary";
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
  getCurrentWindow().setTheme(theme).catch((e) => console.warn("Failed to set theme:", e));
}

function App() {
  const [tabs, setTabs] = useState<Tab[]>(() => [createTab()]);
  const [activeTabId, setActiveTabId] = useState(() => tabs[0].id);
  const [themeMode, setThemeMode] = useState<ThemeMode>(getStoredTheme);
  const { recentFiles, addRecent } = useRecentFiles();
  const tabRefs = useRef<Map<string, DocumentViewHandle>>(new Map());
  const [closePrompt, setClosePrompt] = useState<{ id: string; title: string } | null>(null);
  const [windowClosePrompt, setWindowClosePrompt] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);

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

  // Dynamic window title (affects Dock tooltip, Mission Control, Alt-Tab)
  useEffect(() => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    let title = "Palimpsest";
    if (activeTab && activeTab.title !== "New Tab") {
      const prefix = activeTab.hasChanges ? "● " : "";
      title = `${prefix}${activeTab.title} — Palimpsest`;
    }
    getCurrentWindow().setTitle(title).catch(() => {});
  }, [tabs, activeTabId]);

  // Keep refs in sync so event listeners never see stale values
  const activeTabIdRef = useRef(activeTabId);
  activeTabIdRef.current = activeTabId;
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  // Prevent window close with unsaved changes (red close button)
  useEffect(() => {
    const unlisten = getCurrentWindow().onCloseRequested((event) => {
      const dirty = tabsRef.current.filter((t) => t.hasChanges);
      if (dirty.length > 0) {
        event.preventDefault();
        setWindowClosePrompt(true);
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  // Handle quit request — triggered by Cmd+Q menu item and Dock quit
  const handleQuitRequest = useCallback(() => {
    const dirty = tabsRef.current.filter((t) => t.hasChanges);
    if (dirty.length > 0) {
      setWindowClosePrompt(true);
    } else {
      invoke("confirm_and_exit");
    }
  }, []);

  const handleWindowCloseResult = useCallback(
    async (result: SaveDialogResult) => {
      setWindowClosePrompt(false);
      if (result === "cancel") return;
      if (result === "save") {
        const dirty = tabsRef.current.filter((t) => t.hasChanges);
        for (const t of dirty) {
          tabRefs.current.get(t.id)?.save();
        }
        // Let saves flush
        await new Promise((r) => setTimeout(r, 200));
      }
      await invoke("confirm_and_exit");
    },
    []
  );

  const handleQuitRequestRef = useRef(handleQuitRequest);
  handleQuitRequestRef.current = handleQuitRequest;

  // Sync recent files to native menu
  useEffect(() => {
    invoke("update_recent_files", {
      paths: recentFiles.map((f) => f.path),
    }).catch((e) => console.warn("Failed to update recent files menu:", e));
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
    const unlistenSaveLocked = listen<void>("menu-save-locked", () => {
      tabRefs.current.get(activeTabIdRef.current)?.saveLocked();
    });
    const unlistenMerge = listen<void>("menu-merge", () => {
      tabRefs.current.get(activeTabIdRef.current)?.merge();
    });
    const unlistenToggleSidebar = listen<void>("menu-toggle-sidebar", () => {
      tabRefs.current.get(activeTabIdRef.current)?.toggleSidebar();
    });
    const unlistenToggleGallery = listen<void>("menu-toggle-gallery", () => {
      tabRefs.current.get(activeTabIdRef.current)?.toggleGallery();
    });
    const unlistenZoomIn = listen<void>("menu-zoom-in", () => {
      tabRefs.current.get(activeTabIdRef.current)?.zoomIn();
    });
    const unlistenZoomOut = listen<void>("menu-zoom-out", () => {
      tabRefs.current.get(activeTabIdRef.current)?.zoomOut();
    });
    const unlistenZoomReset = listen<void>("menu-zoom-reset", () => {
      tabRefs.current.get(activeTabIdRef.current)?.zoomReset();
    });
    const unlistenFitWidth = listen<void>("menu-fit-width", () => {
      tabRefs.current.get(activeTabIdRef.current)?.fitWidth();
    });
    const unlistenFitPage = listen<void>("menu-fit-page", () => {
      tabRefs.current.get(activeTabIdRef.current)?.fitPage();
    });
    const unlistenFind = listen<void>("menu-find", () => {
      tabRefs.current.get(activeTabIdRef.current)?.find();
    });
    const unlistenCheckUpdates = listen<void>("menu-check-updates", async () => {
      try {
        const result = await invoke<{ up_to_date: boolean; current_version: string; latest_version: string; release_url: string }>("check_for_updates");
        if (result.up_to_date) {
          const { message } = await import("@tauri-apps/plugin-dialog");
          await message(`You're on the latest version (v${result.current_version}).`, { title: "No Updates Available", kind: "info" });
        } else {
          const { ask } = await import("@tauri-apps/plugin-dialog");
          const download = await ask(`A new version is available: v${result.latest_version} (you have v${result.current_version}).`, { title: "Update Available", kind: "info", okLabel: "Download", cancelLabel: "Later" });
          if (download) {
            const { openUrl } = await import("@tauri-apps/plugin-opener");
            await openUrl(result.release_url);
          }
        }
      } catch (e) {
        const { message } = await import("@tauri-apps/plugin-dialog");
        await message(`Could not check for updates: ${e}`, { title: "Update Check Failed", kind: "error" });
      }
    });
    const unlistenReportBug = listen<void>("menu-report-bug", async () => {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl("https://github.com/bassman2112/palimpsest/issues");
    });
    const unlistenKeyboardShortcuts = listen<void>("menu-keyboard-shortcuts", () => {
      setShowShortcuts(true);
    });
    const unlistenOpenFilePath = listen<string>("open-file-path", (event) => {
      const currentTabs = tabsRef.current;
      const activeId = activeTabIdRef.current;
      const activeTab = currentTabs.find((t) => t.id === activeId);
      if (activeTab && activeTab.title === "New Tab") {
        // Open in current empty tab
        tabRefs.current.get(activeId)?.openPath(event.payload);
      } else {
        // Create a new tab and open there
        const tab = createTab();
        setTabs((prev) => [...prev, tab]);
        setActiveTabId(tab.id);
        // Defer openPath so the DocumentView mounts and registers its ref
        requestAnimationFrame(() => {
          tabRefs.current.get(tab.id)?.openPath(event.payload);
        });
      }
    });
    // Cmd+Q / Dock Quit → check for unsaved changes
    const unlistenMenuQuit = listen<void>("menu-quit", () => {
      handleQuitRequestRef.current();
    });
    const unlistenCheckQuit = listen<void>("check-quit", () => {
      handleQuitRequestRef.current();
    });
    return () => {
      unlistenOpen.then((f) => f());
      unlistenRecent.then((f) => f());
      unlistenSave.then((f) => f());
      unlistenSaveAs.then((f) => f());
      unlistenPrint.then((f) => f());
      unlistenCloseFile.then((f) => f());
      unlistenNewTab.then((f) => f());
      unlistenSaveLocked.then((f) => f());
      unlistenMerge.then((f) => f());
      unlistenToggleSidebar.then((f) => f());
      unlistenToggleGallery.then((f) => f());
      unlistenZoomIn.then((f) => f());
      unlistenZoomOut.then((f) => f());
      unlistenZoomReset.then((f) => f());
      unlistenFitWidth.then((f) => f());
      unlistenFitPage.then((f) => f());
      unlistenFind.then((f) => f());
      unlistenCheckUpdates.then((f) => f());
      unlistenReportBug.then((f) => f());
      unlistenKeyboardShortcuts.then((f) => f());
      unlistenOpenFilePath.then((f) => f());
      unlistenMenuQuit.then((f) => f());
      unlistenCheckQuit.then((f) => f());
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
        <ErrorBoundary key={tab.id}>
          <DocumentView
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
        </ErrorBoundary>
      ))}
      {closePrompt && (
        <SaveDialog
          title={closePrompt.title}
          onResult={handleClosePromptResult}
        />
      )}
      {windowClosePrompt && (
        <SaveDialog
          title="Palimpsest"
          message="You have unsaved changes in one or more tabs. Do you want to save before closing?"
          onResult={handleWindowCloseResult}
        />
      )}
      {showShortcuts && (
        <KeyboardShortcuts onClose={() => setShowShortcuts(false)} />
      )}
    </div>
  );
}

export default App;
