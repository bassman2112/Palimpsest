import { useCallback, useState } from "react";

export interface CustomBookmark {
  id: string;
  pageNumber: number;
  label: string;
}

const STORAGE_KEY = "palimpsest-bookmarks";

type BookmarkStore = Record<string, CustomBookmark[]>;

function loadStore(): BookmarkStore {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function persistStore(store: BookmarkStore) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

export function useCustomBookmarks(filePath: string | null) {
  const [bookmarks, setBookmarks] = useState<CustomBookmark[]>(() => {
    if (!filePath) return [];
    const store = loadStore();
    return (store[filePath] ?? []).sort((a, b) => a.pageNumber - b.pageNumber);
  });

  // Reload when filePath changes
  const [prevPath, setPrevPath] = useState(filePath);
  if (filePath !== prevPath) {
    setPrevPath(filePath);
    if (filePath) {
      const store = loadStore();
      setBookmarks((store[filePath] ?? []).sort((a, b) => a.pageNumber - b.pageNumber));
    } else {
      setBookmarks([]);
    }
  }

  const persist = useCallback(
    (next: CustomBookmark[]) => {
      if (!filePath) return;
      const store = loadStore();
      if (next.length === 0) {
        delete store[filePath];
      } else {
        store[filePath] = next;
      }
      persistStore(store);
    },
    [filePath]
  );

  const isBookmarked = useCallback(
    (pageNumber: number) => bookmarks.some((b) => b.pageNumber === pageNumber),
    [bookmarks]
  );

  const toggleBookmark = useCallback(
    (pageNumber: number) => {
      setBookmarks((prev) => {
        const existing = prev.find((b) => b.pageNumber === pageNumber);
        let next: CustomBookmark[];
        if (existing) {
          next = prev.filter((b) => b.id !== existing.id);
        } else {
          next = [
            ...prev,
            { id: crypto.randomUUID(), pageNumber, label: `Page ${pageNumber}` },
          ].sort((a, b) => a.pageNumber - b.pageNumber);
        }
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const updateLabel = useCallback(
    (id: string, label: string) => {
      setBookmarks((prev) => {
        const next = prev.map((b) => (b.id === id ? { ...b, label } : b));
        persist(next);
        return next;
      });
    },
    [persist]
  );

  const removeBookmark = useCallback(
    (id: string) => {
      setBookmarks((prev) => {
        const next = prev.filter((b) => b.id !== id);
        persist(next);
        return next;
      });
    },
    [persist]
  );

  return { bookmarks, isBookmarked, toggleBookmark, updateLabel, removeBookmark };
}
