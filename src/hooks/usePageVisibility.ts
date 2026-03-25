import { useCallback, useEffect, useRef, useState } from "react";

interface UsePageVisibilityOptions {
  zoom: number;
  totalPages: number;
}

/** Score each page by how visible it is and how close to the viewport top. */
function computeCurrentPage(container: HTMLElement): number | null {
  const containerRect = container.getBoundingClientRect();
  let bestPage: number | null = null;
  let bestScore = 0;
  const allPages = container.querySelectorAll("[data-page-number]");
  for (const el of allPages) {
    const rect = el.getBoundingClientRect();
    if (rect.bottom <= containerRect.top || rect.top >= containerRect.bottom) continue;
    const pageNum = Number((el as HTMLElement).dataset.pageNumber);
    const visibleTop = Math.max(rect.top, containerRect.top);
    const visibleBottom = Math.min(rect.bottom, containerRect.bottom);
    const ratio = (visibleBottom - visibleTop) / rect.height;
    const distFromTop = Math.abs(rect.top - containerRect.top);
    const score = ratio / (1 + distFromTop / containerRect.height);
    if (score > bestScore) {
      bestScore = score;
      bestPage = pageNum;
    }
  }
  return bestPage;
}

export function usePageVisibility({ zoom, totalPages }: UsePageVisibilityOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [visiblePages, setVisiblePages] = useState<Set<number>>(new Set([1]));
  const [currentPage, setCurrentPage] = useState(1);

  // IntersectionObserver for visible page tracking (prefetch with large rootMargin)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || totalPages === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePages((prev) => {
          const next = new Set(prev);
          for (const entry of entries) {
            const el = entry.target as HTMLElement;
            const pageNum = Number(el.dataset.pageNumber);
            if (entry.isIntersecting) {
              next.add(pageNum);
            } else {
              next.delete(pageNum);
            }
          }
          return next;
        });

        const best = computeCurrentPage(container);
        if (best !== null) setCurrentPage(best);
      },
      {
        root: container,
        rootMargin: "100% 0px",
        threshold: [0, 0.5, 1],
      }
    );

    const pages = container.querySelectorAll("[data-page-number]");
    pages.forEach((el) => observer.observe(el));

    return () => observer.disconnect();
  }, [zoom, totalPages]);

  // Scroll listener for current page — catches cases the IntersectionObserver
  // misses (e.g. smooth scroll within the large rootMargin where no thresholds
  // are crossed).
  useEffect(() => {
    const container = containerRef.current;
    if (!container || totalPages === 0) return;

    let rafId = 0;
    const handleScroll = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const best = computeCurrentPage(container);
        if (best !== null) setCurrentPage(best);
      });
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(rafId);
    };
  }, [zoom, totalPages]);

  const scrollToPage = useCallback((pageNumber: number) => {
    const container = containerRef.current;
    if (!container) return;
    const el = container.querySelector(`[data-page-number="${pageNumber}"]`) as HTMLElement | null;
    if (el) {
      container.scrollTo({
        top: el.offsetTop - container.offsetTop,
        behavior: "smooth",
      });
    }
  }, []);

  return { containerRef, visiblePages, currentPage, scrollToPage };
}
