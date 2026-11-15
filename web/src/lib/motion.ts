/** Motion tokens shared by CSS (see styles/tokens.css) and motion/react. */
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
export const EASE_DRAWER = [0.32, 0.72, 0, 1] as const;

/** UI transitions stay within 150-300 ms. */
export const DUR = { fast: 0.15, base: 0.2, slow: 0.28 } as const;

/** Stagger for list entrances: 40 ms per item, capped so long lists do not wait. */
export const stagger = (i: number) => Math.min(i, 8) * 0.04;

/** Entrance used by cards and rows: never from scale(0). */
export const enter = {
  initial: { opacity: 0, y: 8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, scale: 0.98 },
} as const;
