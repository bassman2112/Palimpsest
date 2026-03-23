import { useCallback, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";

export interface SearchMatch {
  pageNumber: number;
  index: number;
}

export function useTextSearch(pdfDoc: PDFDocumentProxy | null) {
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [currentQuery, setCurrentQuery] = useState("");
  const searchIdRef = useRef(0);
  const lastQueryRef = useRef("");

  const search = useCallback(async (query: string) => {
    if (!query.trim() || !pdfDoc) {
      setMatches([]);
      setCurrentMatchIndex(-1);
      setSearching(false);
      setCurrentQuery("");
      lastQueryRef.current = "";
      return;
    }

    // Same query already searched — skip re-search
    if (query === lastQueryRef.current) return;
    lastQueryRef.current = query;

    const id = ++searchIdRef.current;
    setSearching(true);
    setCurrentQuery(query);

    const needle = query.toLowerCase();
    const found: SearchMatch[] = [];

    for (let i = 1; i <= pdfDoc.numPages; i++) {
      if (searchIdRef.current !== id) return;
      try {
        const page = await pdfDoc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items
          .map((item: any) => item.str ?? "")
          .join("")
          .toLowerCase();

        let pos = 0;
        while ((pos = text.indexOf(needle, pos)) !== -1) {
          found.push({ pageNumber: i, index: pos });
          pos += needle.length;
        }
      } catch {
        // skip pages that fail
      }
    }

    if (searchIdRef.current !== id) return;

    setMatches(found);
    setCurrentMatchIndex(found.length > 0 ? 0 : -1);
    setSearching(false);
  }, [pdfDoc]);

  const nextMatch = useCallback(() => {
    setCurrentMatchIndex((i) => (matches.length === 0 ? -1 : (i + 1) % matches.length));
  }, [matches.length]);

  const prevMatch = useCallback(() => {
    setCurrentMatchIndex((i) =>
      matches.length === 0 ? -1 : (i - 1 + matches.length) % matches.length
    );
  }, [matches.length]);

  const clearSearch = useCallback(() => {
    searchIdRef.current++;
    setMatches([]);
    setCurrentMatchIndex(-1);
    setSearching(false);
    setCurrentQuery("");
    lastQueryRef.current = "";
  }, []);

  const currentMatch = currentMatchIndex >= 0 ? matches[currentMatchIndex] : null;

  return {
    matches,
    currentMatchIndex,
    currentMatch,
    searching,
    currentQuery,
    search,
    nextMatch,
    prevMatch,
    clearSearch,
  };
}
