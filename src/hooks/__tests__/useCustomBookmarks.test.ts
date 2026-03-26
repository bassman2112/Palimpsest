import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useCustomBookmarks } from "../useCustomBookmarks";

const STORAGE_KEY = "palimpsest-bookmarks";

// Simple in-memory localStorage mock
const store: Record<string, string> = {};
const localStorageMock = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
  clear: () => { for (const k of Object.keys(store)) delete store[k]; },
  get length() { return Object.keys(store).length; },
  key: (i: number) => Object.keys(store)[i] ?? null,
};

vi.stubGlobal("localStorage", localStorageMock);

beforeEach(() => {
  localStorageMock.clear();
});

describe("useCustomBookmarks", () => {
  it("starts empty for a new path", () => {
    const { result } = renderHook(() => useCustomBookmarks("/test.pdf"));
    expect(result.current.bookmarks).toEqual([]);
  });

  it("returns empty when path is null", () => {
    const { result } = renderHook(() => useCustomBookmarks(null));
    expect(result.current.bookmarks).toEqual([]);
    expect(result.current.isBookmarked(1)).toBe(false);
  });

  it("toggleBookmark adds a bookmark", () => {
    const { result } = renderHook(() => useCustomBookmarks("/test.pdf"));
    act(() => result.current.toggleBookmark(3));
    expect(result.current.bookmarks).toHaveLength(1);
    expect(result.current.bookmarks[0].pageNumber).toBe(3);
    expect(result.current.bookmarks[0].label).toBe("Page 3");
    expect(result.current.isBookmarked(3)).toBe(true);
  });

  it("toggleBookmark removes an existing bookmark", () => {
    const { result } = renderHook(() => useCustomBookmarks("/test.pdf"));
    act(() => result.current.toggleBookmark(5));
    expect(result.current.isBookmarked(5)).toBe(true);
    act(() => result.current.toggleBookmark(5));
    expect(result.current.isBookmarked(5)).toBe(false);
    expect(result.current.bookmarks).toHaveLength(0);
  });

  it("isBookmarked returns correct values", () => {
    const { result } = renderHook(() => useCustomBookmarks("/test.pdf"));
    act(() => result.current.toggleBookmark(2));
    expect(result.current.isBookmarked(2)).toBe(true);
    expect(result.current.isBookmarked(3)).toBe(false);
  });

  it("updateLabel changes a bookmark label", () => {
    const { result } = renderHook(() => useCustomBookmarks("/test.pdf"));
    act(() => result.current.toggleBookmark(1));
    const id = result.current.bookmarks[0].id;
    act(() => result.current.updateLabel(id, "Introduction"));
    expect(result.current.bookmarks[0].label).toBe("Introduction");
  });

  it("removeBookmark removes by id", () => {
    const { result } = renderHook(() => useCustomBookmarks("/test.pdf"));
    act(() => result.current.toggleBookmark(1));
    act(() => result.current.toggleBookmark(2));
    const id = result.current.bookmarks[0].id;
    act(() => result.current.removeBookmark(id));
    expect(result.current.bookmarks).toHaveLength(1);
    expect(result.current.bookmarks[0].pageNumber).toBe(2);
  });

  it("bookmarks are sorted by pageNumber", () => {
    const { result } = renderHook(() => useCustomBookmarks("/test.pdf"));
    act(() => result.current.toggleBookmark(5));
    act(() => result.current.toggleBookmark(1));
    act(() => result.current.toggleBookmark(3));
    expect(result.current.bookmarks.map((b) => b.pageNumber)).toEqual([1, 3, 5]);
  });

  it("persists bookmarks to localStorage", () => {
    const { result } = renderHook(() => useCustomBookmarks("/test.pdf"));
    act(() => result.current.toggleBookmark(7));
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored["/test.pdf"]).toHaveLength(1);
    expect(stored["/test.pdf"][0].pageNumber).toBe(7);
  });

  it("loads persisted bookmarks on mount", () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        "/saved.pdf": [{ id: "abc", pageNumber: 4, label: "Chapter 1" }],
      })
    );
    const { result } = renderHook(() => useCustomBookmarks("/saved.pdf"));
    expect(result.current.bookmarks).toHaveLength(1);
    expect(result.current.bookmarks[0].label).toBe("Chapter 1");
  });

  it("isolates bookmarks per file path", () => {
    const { result: r1 } = renderHook(() => useCustomBookmarks("/a.pdf"));
    act(() => r1.current.toggleBookmark(1));

    const { result: r2 } = renderHook(() => useCustomBookmarks("/b.pdf"));
    expect(r2.current.bookmarks).toHaveLength(0);
  });

  it("removes storage key when last bookmark is removed", () => {
    const { result } = renderHook(() => useCustomBookmarks("/test.pdf"));
    act(() => result.current.toggleBookmark(1));
    act(() => result.current.toggleBookmark(1));
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    expect(stored["/test.pdf"]).toBeUndefined();
  });
});
