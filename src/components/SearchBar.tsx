import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface SearchBarHandle {
  focus: () => void;
}

interface SearchBarProps {
  matchCount: number;
  currentMatchIndex: number;
  searching: boolean;
  onSearch: (query: string) => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
}

export const SearchBar = forwardRef<SearchBarHandle, SearchBarProps>(function SearchBar(
  { matchCount, currentMatchIndex, searching, onSearch, onNext, onPrev, onClose },
  ref
) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  useImperativeHandle(ref, () => ({
    focus: () => {
      inputRef.current?.focus();
      inputRef.current?.select();
    },
  }));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    return () => clearTimeout(debounceRef.current);
  }, []);

  const handleChange = (value: string) => {
    setQuery(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      onSearchRef.current(value);
    }, 300);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "Enter") {
      clearTimeout(debounceRef.current);
      onSearchRef.current(query);
      if (e.shiftKey) {
        onPrev();
      } else {
        onNext();
      }
    }
  };

  const statusText = () => {
    if (!query) return "";
    if (searching) return "Searching...";
    if (matchCount === 0) return "No matches";
    return `${currentMatchIndex + 1} of ${matchCount}`;
  };

  return (
    <div className="search-bar">
      <input
        ref={inputRef}
        className="search-input"
        type="text"
        placeholder="Find in document..."
        value={query}
        onChange={(e) => handleChange(e.target.value)}
        onKeyDown={handleKeyDown}
      />
      <span className="search-status">{statusText()}</span>
      <button
        className="search-nav-btn"
        onClick={onPrev}
        disabled={matchCount === 0}
        title="Previous (Shift+Enter)"
      >
        ‹
      </button>
      <button
        className="search-nav-btn"
        onClick={onNext}
        disabled={matchCount === 0}
        title="Next (Enter)"
      >
        ›
      </button>
      <button className="search-close-btn" onClick={onClose} title="Close (Esc)">
        ✕
      </button>
    </div>
  );
});
