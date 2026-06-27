// lib/page-shell/use-pull-to-refresh.ts

import { useEffect, useRef } from "react";

interface UsePullToRefreshOptions {
  onRefresh: () => void;
  threshold?: number;
  disabled?: boolean;
}

export function usePullToRefresh({
  onRefresh,
  threshold = 72,
  disabled = false,
}: UsePullToRefreshOptions) {
  const startYRef = useRef<number | null>(null);
  const isPullingRef = useRef(false);

  useEffect(() => {
    if (disabled || typeof window === "undefined") return;

    function onTouchStart(e: TouchEvent) {
      if (window.scrollY === 0) {
        startYRef.current = e.touches[0]?.clientY ?? 0;
        isPullingRef.current = false;
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (startYRef.current === null) return;
      const delta = (e.touches[0]?.clientY ?? 0) - startYRef.current;
      if (delta > 0 && window.scrollY === 0) {
        isPullingRef.current = true;
      }
    }

    function onTouchEnd() {
      if (!isPullingRef.current) return;
      const delta =
        startYRef.current !== null
          ? (window as any)._lastTouchY - startYRef.current
          : 0;
      if (delta >= threshold) {
        onRefresh();
      }
      startYRef.current = null;
      isPullingRef.current = false;
    }

    function onTouchMoveTrack(e: TouchEvent) {
      (window as any)._lastTouchY = e.touches[0]?.clientY ?? 0;
    }

    document.addEventListener("touchstart", onTouchStart, { passive: true });
    document.addEventListener("touchmove", onTouchMove, { passive: true });
    document.addEventListener("touchmove", onTouchMoveTrack, { passive: true });
    document.addEventListener("touchend", onTouchEnd);

    return () => {
      document.removeEventListener("touchstart", onTouchStart);
      document.removeEventListener("touchmove", onTouchMove);
      document.removeEventListener("touchmove", onTouchMoveTrack);
      document.removeEventListener("touchend", onTouchEnd);
    };
  }, [onRefresh, threshold, disabled]);
}