import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTextSearch } from "../useTextSearch";
import type { PdfDocument, PdfPage, PdfTextItem } from "../../lib/pdf/types";

function mockPage(pageNumber: number, text: string): PdfPage {
  return {
    pageNumber,
    getViewport: () => ({ width: 612, height: 792, _raw: null }),
    renderToCanvas: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    renderTextLayer: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    renderAnnotationLayer: () => ({ promise: Promise.resolve(), cancel: () => {} }),
    getTextContent: async (): Promise<PdfTextItem[]> => [{ str: text }],
  };
}

function mockDoc(pages: { text: string }[]): PdfDocument {
  return {
    numPages: pages.length,
    getPage: async (n: number) => mockPage(n, pages[n - 1].text),
    getFormData: () => null,
    onFormModified: () => () => {},
    annotationStorage: null,
    destroy: async () => {},
  };
}

describe("useTextSearch", () => {
  it("empty query clears matches", async () => {
    const doc = mockDoc([{ text: "hello world" }]);
    const { result } = renderHook(() => useTextSearch(doc));

    await act(async () => { await result.current.search("hello"); });
    expect(result.current.matches.length).toBeGreaterThan(0);

    await act(async () => { await result.current.search(""); });
    expect(result.current.matches).toHaveLength(0);
    expect(result.current.currentMatchIndex).toBe(-1);
  });

  it("finds a single match on one page", async () => {
    const doc = mockDoc([{ text: "hello world" }]);
    const { result } = renderHook(() => useTextSearch(doc));

    await act(async () => { await result.current.search("hello"); });
    expect(result.current.matches).toHaveLength(1);
    expect(result.current.matches[0].pageNumber).toBe(1);
    expect(result.current.currentMatchIndex).toBe(0);
  });

  it("finds multiple matches on same page", async () => {
    const doc = mockDoc([{ text: "cat and cat and cat" }]);
    const { result } = renderHook(() => useTextSearch(doc));

    await act(async () => { await result.current.search("cat"); });
    expect(result.current.matches).toHaveLength(3);
  });

  it("finds matches across multiple pages", async () => {
    const doc = mockDoc([{ text: "foo bar" }, { text: "baz foo" }, { text: "no match" }]);
    const { result } = renderHook(() => useTextSearch(doc));

    await act(async () => { await result.current.search("foo"); });
    expect(result.current.matches).toHaveLength(2);
    expect(result.current.matches[0].pageNumber).toBe(1);
    expect(result.current.matches[1].pageNumber).toBe(2);
  });

  it("search is case-insensitive", async () => {
    const doc = mockDoc([{ text: "Hello HELLO hElLo" }]);
    const { result } = renderHook(() => useTextSearch(doc));

    await act(async () => { await result.current.search("hello"); });
    expect(result.current.matches).toHaveLength(3);
  });

  it("nextMatch cycles from last to first", async () => {
    const doc = mockDoc([{ text: "aaa" }, { text: "aaa" }]);
    const { result } = renderHook(() => useTextSearch(doc));

    await act(async () => { await result.current.search("aaa"); });
    expect(result.current.matches).toHaveLength(2);
    expect(result.current.currentMatchIndex).toBe(0);

    act(() => result.current.nextMatch());
    expect(result.current.currentMatchIndex).toBe(1);

    act(() => result.current.nextMatch());
    expect(result.current.currentMatchIndex).toBe(0); // wrapped
  });

  it("prevMatch wraps from first to last", async () => {
    const doc = mockDoc([{ text: "aaa" }, { text: "aaa" }]);
    const { result } = renderHook(() => useTextSearch(doc));

    await act(async () => { await result.current.search("aaa"); });
    expect(result.current.currentMatchIndex).toBe(0);

    act(() => result.current.prevMatch());
    expect(result.current.currentMatchIndex).toBe(1); // wrapped to last
  });

  it("same query is not re-searched", async () => {
    const doc = mockDoc([{ text: "hello world" }]);
    const { result } = renderHook(() => useTextSearch(doc));

    await act(async () => { await result.current.search("hello"); });
    const matches1 = result.current.matches;

    await act(async () => { await result.current.search("hello"); });
    // Same reference — search was skipped
    expect(result.current.matches).toBe(matches1);
  });

  it("clearSearch resets everything", async () => {
    const doc = mockDoc([{ text: "hello world" }]);
    const { result } = renderHook(() => useTextSearch(doc));

    await act(async () => { await result.current.search("hello"); });
    expect(result.current.matches).toHaveLength(1);

    act(() => result.current.clearSearch());
    expect(result.current.matches).toHaveLength(0);
    expect(result.current.currentMatchIndex).toBe(-1);
    expect(result.current.currentQuery).toBe("");
  });
});
