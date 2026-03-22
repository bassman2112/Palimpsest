import { useCallback, useRef, useState } from "react";
import type { Annotation } from "../types";

const UPDATE_DEBOUNCE_MS = 1000;

export function useAnnotations(initial: Annotation[] = []) {
  const [annotations, setAnnotations] = useState<Annotation[]>(initial);
  const [hasChanges, setHasChanges] = useState(false);
  const undoStack = useRef<Annotation[][]>([]);
  const redoStack = useRef<Annotation[][]>([]);
  // Ref that always mirrors the latest committed annotations state
  const currentRef = useRef<Annotation[]>(initial);
  // Track last update for debouncing text edits
  const lastUpdate = useRef<{ id: string; time: number } | null>(null);

  const pushUndo = useCallback(() => {
    undoStack.current.push(currentRef.current);
    if (undoStack.current.length > 50) undoStack.current.shift();
    redoStack.current = [];
  }, []);

  const commit = useCallback((updater: (prev: Annotation[]) => Annotation[]) => {
    setAnnotations((prev) => {
      const next = updater(prev);
      currentRef.current = next;
      return next;
    });
    setHasChanges(true);
  }, []);

  const add = useCallback((annotation: Annotation) => {
    lastUpdate.current = null;
    pushUndo();
    commit((prev) => [...prev, annotation]);
  }, [pushUndo, commit]);

  const update = useCallback((id: string, updates: Partial<Annotation>) => {
    // Debounce: if updating the same annotation within the window, skip pushing undo
    // so that rapid keystrokes collapse into a single undo entry
    const now = Date.now();
    const last = lastUpdate.current;
    if (!last || last.id !== id || now - last.time > UPDATE_DEBOUNCE_MS) {
      pushUndo();
    }
    lastUpdate.current = { id, time: now };

    commit((prev) =>
      prev.map((a) => (a.id === id ? { ...a, ...updates } as Annotation : a))
    );
  }, [pushUndo, commit]);

  const remove = useCallback((id: string) => {
    lastUpdate.current = null;
    pushUndo();
    commit((prev) => prev.filter((a) => a.id !== id));
  }, [pushUndo, commit]);

  const undo = useCallback((): boolean => {
    const prev = undoStack.current.pop();
    if (prev !== undefined) {
      lastUpdate.current = null;
      redoStack.current.push(currentRef.current);
      setAnnotations(prev);
      currentRef.current = prev;
      setHasChanges(true);
      return true;
    }
    return false;
  }, []);

  const redo = useCallback((): boolean => {
    const next = redoStack.current.pop();
    if (next !== undefined) {
      lastUpdate.current = null;
      undoStack.current.push(currentRef.current);
      setAnnotations(next);
      currentRef.current = next;
      setHasChanges(true);
      return true;
    }
    return false;
  }, []);

  const resetAnnotations = useCallback((newAnnotations: Annotation[]) => {
    setAnnotations(newAnnotations);
    currentRef.current = newAnnotations;
    setHasChanges(false);
    undoStack.current = [];
    redoStack.current = [];
    lastUpdate.current = null;
  }, []);

  const getPageAnnotations = useCallback(
    (pageNumber: number) => annotations.filter((a) => a.pageNumber === pageNumber),
    [annotations]
  );

  const markSaved = useCallback(() => {
    setHasChanges(false);
  }, []);

  return {
    annotations,
    hasChanges,
    add,
    update,
    remove,
    undo,
    redo,
    resetAnnotations,
    getPageAnnotations,
    markSaved,
  };
}
