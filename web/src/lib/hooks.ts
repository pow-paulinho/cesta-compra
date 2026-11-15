import { useEffect, useState, useSyncExternalStore } from 'react';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (l) => {
      const m = window.matchMedia(query);
      m.addEventListener('change', l);
      return () => m.removeEventListener('change', l);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useIsDesktop = () => useMediaQuery('(min-width: 768px)');

/** Locks page scroll while an overlay is open. */
export function useScrollLock(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [active]);
}

/** A value that only becomes true after `ms`, to avoid flashing loaders for fast answers. */
export function useDelayed(flag: boolean, ms: number): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!flag) {
      setOn(false);
      return;
    }
    const t = setTimeout(() => setOn(true), ms);
    return () => clearTimeout(t);
  }, [flag, ms]);
  return on;
}
