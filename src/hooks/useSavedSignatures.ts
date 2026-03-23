import { useCallback, useState } from "react";
import type { SignatureKind } from "../components/SignatureModal";

interface SavedSignature {
  id: string;
  name: string;
  imageData: string; // data URL
  kind?: SignatureKind;
}

const STORAGE_KEY = "palimpsest-signatures";
const MAX_SIGNATURES = 10;

function loadSignatures(): SavedSignature[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function persistSignatures(sigs: SavedSignature[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(sigs));
}

export function useSavedSignatures() {
  const [signatures, setSignatures] = useState<SavedSignature[]>(loadSignatures);

  const addSignature = useCallback((name: string, imageData: string, kind: SignatureKind = "signature") => {
    setSignatures((prev) => {
      const next = [
        { id: crypto.randomUUID(), name, imageData, kind },
        ...prev,
      ].slice(0, MAX_SIGNATURES);
      persistSignatures(next);
      return next;
    });
  }, []);

  const removeSignature = useCallback((id: string) => {
    setSignatures((prev) => {
      const next = prev.filter((s) => s.id !== id);
      persistSignatures(next);
      return next;
    });
  }, []);

  return { signatures, addSignature, removeSignature };
}
