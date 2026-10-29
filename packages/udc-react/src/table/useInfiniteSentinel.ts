import { type RefObject, useEffect } from "react";
import type { UdcCollectionResult } from "../udc/hooks";

/**
 * Infinite mode: when `sentinel` (an element under the last row or card)
 * comes within 240 px of the bottom of the scrolling `root`, ask for the
 * next page. The table and the cards share it.
 */
export function useInfiniteSentinel(
  enabled: boolean,
  root: RefObject<HTMLElement | null>,
  sentinel: RefObject<HTMLElement | null>,
  data: Pick<UdcCollectionResult, "hasNextPage" | "isFetchingNextPage" | "fetchNextPage">,
): void {
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = data;
  useEffect(() => {
    if (!enabled) return;
    const el = sentinel.current;
    const rootEl = root.current;
    if (!el || !rootEl) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting) && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { root: rootEl, rootMargin: "0px 0px 240px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [enabled, root, sentinel, hasNextPage, isFetchingNextPage, fetchNextPage]);
}
