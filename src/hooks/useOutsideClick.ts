import { useEffect } from "react";

/**
 * Closes something when clicking outside a set of refs.
 * Uses capture phase so we intercept before other handlers.
 */
export function useOutsideClick(
  refs: React.RefObject<HTMLElement | null>[],
  active: boolean,
  onClose: () => void,
  /** Extra selectors that should NOT trigger close (e.g., ".annotation-context-menu"). */
  ignoreSelectors?: string[],
): void {
  useEffect(() => {
    if (!active) return;

    function handleOutsideClick(e: MouseEvent) {
      const target = e.target as Node;
      for (const ref of refs) {
        if (ref.current?.contains(target)) return;
      }
      if (ignoreSelectors) {
        for (const sel of ignoreSelectors) {
          if ((target as HTMLElement).closest?.(sel)) return;
        }
      }
      e.stopPropagation();
      onClose();
    }

    // Delay so current click doesn't immediately close
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleOutsideClick, true);
    }, 0);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleOutsideClick, true);
    };
  }, [active, onClose, refs, ignoreSelectors]);
}
