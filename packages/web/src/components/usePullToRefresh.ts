import { useRef, useState } from 'react';

export const PTR_THRESHOLD = 72;
export const PTR_MAX_PULL = 110;

/**
 * Pull-to-refresh for the standalone PWA (no browser chrome to reload with).
 * Attach the handlers to the scroll container; when released past the
 * threshold while scrolled to the very top, onRefresh fires.
 * ponytail: no preventDefault — in standalone mode there is no native
 * pull gesture to suppress, so passive listeners are fine.
 */
export function usePullToRefresh(onRefresh: () => void) {
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const tracking = useRef(false);

  function onTouchStart(e: React.TouchEvent<HTMLElement>) {
    if (refreshing) return;
    if (e.currentTarget.scrollTop <= 0) {
      startY.current = e.touches[0]?.clientY ?? 0;
      tracking.current = true;
    }
  }

  function onTouchMove(e: React.TouchEvent<HTMLElement>) {
    if (!tracking.current || refreshing) return;
    const dy = (e.touches[0]?.clientY ?? 0) - startY.current;
    if (dy > 0 && e.currentTarget.scrollTop <= 0) {
      // resistance curve: the indicator moves at half the finger speed
      setPull(Math.min(dy * 0.5, PTR_MAX_PULL));
    } else {
      tracking.current = false;
      setPull(0);
    }
  }

  function onTouchEnd() {
    if (!tracking.current) return;
    tracking.current = false;
    if (pull >= PTR_THRESHOLD && !refreshing) {
      setRefreshing(true);
      onRefresh();
    }
    setPull(0);
  }

  return { pull, refreshing, onTouchStart, onTouchMove, onTouchEnd };
}
