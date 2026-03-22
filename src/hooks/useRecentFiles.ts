import { useCallback, useState } from "react";

const STORAGE_KEY = "palimpsest-recent-files";
const MAX_RECENT = 10;

export interface RecentFile {
  path: string;
  name: string;
  openedAt: number;
}

function loadRecent(): RecentFile[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export function useRecentFiles() {
  const [recentFiles, setRecentFiles] = useState<RecentFile[]>(loadRecent);

  const addRecent = useCallback((path: string) => {
    const name = path.split(/[\\/]/).pop() || path;
    setRecentFiles((prev) => {
      const filtered = prev.filter((f) => f.path !== path);
      const next = [{ path, name, openedAt: Date.now() }, ...filtered].slice(0, MAX_RECENT);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  return { recentFiles, addRecent };
}
