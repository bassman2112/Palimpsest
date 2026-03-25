import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAnnotations } from "../useAnnotations";
import type { Annotation } from "../../types";

function makeHighlight(id: string, page = 1): Annotation {
  return {
    id,
    type: "highlight",
    pageNumber: page,
    x: 0.1,
    y: 0.2,
    width: 0.3,
    height: 0.04,
    color: "#ffff00",
  };
}

describe("useAnnotations", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it("add: annotation appears and hasChanges is true", () => {
    const { result } = renderHook(() => useAnnotations());
    act(() => result.current.add(makeHighlight("a")));
    expect(result.current.annotations).toHaveLength(1);
    expect(result.current.annotations[0].id).toBe("a");
    expect(result.current.hasChanges).toBe(true);
  });

  it("update: field updated on correct annotation", () => {
    const { result } = renderHook(() => useAnnotations());
    act(() => result.current.add(makeHighlight("a")));
    act(() => result.current.update("a", { color: "#ff0000" }));
    const ann = result.current.annotations[0];
    expect(ann.type === "highlight" && ann.color).toBe("#ff0000");
  });

  it("remove: annotation removed by id", () => {
    const { result } = renderHook(() => useAnnotations());
    act(() => result.current.add(makeHighlight("a")));
    act(() => result.current.add(makeHighlight("b")));
    act(() => result.current.remove("a"));
    expect(result.current.annotations).toHaveLength(1);
    expect(result.current.annotations[0].id).toBe("b");
  });

  it("getPageAnnotations: filters by page number", () => {
    const { result } = renderHook(() => useAnnotations());
    act(() => result.current.add(makeHighlight("a", 1)));
    act(() => result.current.add(makeHighlight("b", 2)));
    act(() => result.current.add(makeHighlight("c", 1)));
    expect(result.current.getPageAnnotations(1)).toHaveLength(2);
    expect(result.current.getPageAnnotations(2)).toHaveLength(1);
    expect(result.current.getPageAnnotations(3)).toHaveLength(0);
  });

  it("undo/redo round-trip: add → undo → redo restores state", () => {
    const { result } = renderHook(() => useAnnotations());
    act(() => result.current.add(makeHighlight("a")));
    expect(result.current.annotations).toHaveLength(1);

    let undid: boolean;
    act(() => { undid = result.current.undo(); });
    expect(undid!).toBe(true);
    expect(result.current.annotations).toHaveLength(0);

    let redid: boolean;
    act(() => { redid = result.current.redo(); });
    expect(redid!).toBe(true);
    expect(result.current.annotations).toHaveLength(1);
  });

  it("undo on empty stack returns false", () => {
    const { result } = renderHook(() => useAnnotations());
    let undid: boolean;
    act(() => { undid = result.current.undo(); });
    expect(undid!).toBe(false);
  });

  it("redo on empty stack returns false", () => {
    const { result } = renderHook(() => useAnnotations());
    let redid: boolean;
    act(() => { redid = result.current.redo(); });
    expect(redid!).toBe(false);
  });

  it("redo cleared on new action: add → undo → add(new) → redo returns false", () => {
    const { result } = renderHook(() => useAnnotations());
    act(() => result.current.add(makeHighlight("a")));
    act(() => { result.current.undo(); });
    act(() => result.current.add(makeHighlight("b")));

    let redid: boolean;
    act(() => { redid = result.current.redo(); });
    expect(redid!).toBe(false);
  });

  it("max 50 undo entries: 52 adds → undo 50 succeeds → 51st fails", () => {
    const { result } = renderHook(() => useAnnotations());
    for (let i = 0; i < 52; i++) {
      act(() => result.current.add(makeHighlight(`a${i}`)));
    }

    let count = 0;
    for (let i = 0; i < 51; i++) {
      let ok: boolean;
      act(() => { ok = result.current.undo(); });
      if (ok!) count++;
    }
    expect(count).toBe(50);
  });

  it("update debounce: two rapid updates on same id → only 1 undo entry", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useAnnotations());
    act(() => result.current.add(makeHighlight("a")));

    // Two rapid updates within debounce window
    act(() => result.current.update("a", { color: "#ff0000" }));
    act(() => result.current.update("a", { color: "#00ff00" }));

    // Undo the second update (same undo entry as first since debounced)
    act(() => { result.current.undo(); });
    // Undo the add
    act(() => { result.current.undo(); });
    // Should now be empty — only 2 undo entries (add + one debounced update group)
    expect(result.current.annotations).toHaveLength(0);

    // One more undo should fail (stack empty)
    let ok: boolean;
    act(() => { ok = result.current.undo(); });
    expect(ok!).toBe(false);

    vi.useRealTimers();
  });

  it("update different ids: update A then B → 2 undo entries", () => {
    const { result } = renderHook(() => useAnnotations());
    act(() => result.current.add(makeHighlight("a")));
    act(() => result.current.add(makeHighlight("b")));
    act(() => result.current.update("a", { color: "#ff0000" }));
    act(() => result.current.update("b", { color: "#00ff00" }));

    // Undo update B
    act(() => { result.current.undo(); });
    const b = result.current.annotations.find((a) => a.id === "b")!;
    expect(b.type === "highlight" && b.color).toBe("#ffff00");

    // Undo update A
    act(() => { result.current.undo(); });
    const a = result.current.annotations.find((ann) => ann.id === "a")!;
    expect(a.type === "highlight" && a.color).toBe("#ffff00");
  });

  it("resetAnnotations: clears undo/redo and sets hasChanges false", () => {
    const { result } = renderHook(() => useAnnotations());
    act(() => result.current.add(makeHighlight("a")));
    expect(result.current.hasChanges).toBe(true);

    act(() => result.current.resetAnnotations([makeHighlight("b")]));
    expect(result.current.hasChanges).toBe(false);
    expect(result.current.annotations).toHaveLength(1);
    expect(result.current.annotations[0].id).toBe("b");

    let ok: boolean;
    act(() => { ok = result.current.undo(); });
    expect(ok!).toBe(false);
    act(() => { ok = result.current.redo(); });
    expect(ok!).toBe(false);
  });

  it("markSaved: sets hasChanges false without affecting stacks", () => {
    const { result } = renderHook(() => useAnnotations());
    act(() => result.current.add(makeHighlight("a")));
    expect(result.current.hasChanges).toBe(true);

    act(() => result.current.markSaved());
    expect(result.current.hasChanges).toBe(false);

    // Undo should still work
    let ok: boolean;
    act(() => { ok = result.current.undo(); });
    expect(ok!).toBe(true);
    expect(result.current.annotations).toHaveLength(0);
  });
});
