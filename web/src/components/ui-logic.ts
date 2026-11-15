/**
 * Pure helpers behind the UI primitives (ui.tsx, ProductCard.tsx): no React, no DOM, so
 * test/web-components-*.test.ts can run them directly.
 */

// ---------------------------------------------------------------------------
// Quantity stepper
// ---------------------------------------------------------------------------

/** Why a typed quantity was changed on commit, so the stepper can say so. */
export type QtyHint = 'min' | 'max' | null;

/** What the quantity field keeps while typing: digits only, up to 3 so "120" stays visible until it is committed. */
export function qtyDraft(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 3);
}

/** The quantity a typed value commits to, and whether it had to be clamped. An empty field keeps the current value. */
export function commitQty(raw: string, current: number, min: number, max: number): { value: number; hint: QtyHint } {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return { value: current, hint: null };
  if (n > max) return { value: max, hint: 'max' };
  if (n < min) return { value: min, hint: 'min' };
  return { value: n, hint: null };
}

/** "1 unidad", "2 unidades". */
export function unitsLabel(n: number): string {
  return `${n} ${n === 1 ? 'unidad' : 'unidades'}`;
}

/** The short note shown under the stepper when a typed quantity was clamped. */
export function qtyHintText(hint: Exclude<QtyHint, null>, min: number, max: number): string {
  return hint === 'max' ? `Máximo ${unitsLabel(max)}` : `Mínimo ${unitsLabel(min)}`;
}

/** Spinbutton keys (WAI-ARIA): arrows step by 1, Page keys by 10, Home/End jump to the limits. Null for any other key. */
export function stepKey(key: string, value: number, min: number, max: number): number | null {
  const delta: Record<string, number> = { ArrowUp: 1, ArrowDown: -1, PageUp: 10, PageDown: -10 };
  if (key === 'Home') return min;
  if (key === 'End') return max;
  const d = delta[key];
  if (d === undefined) return null;
  return Math.max(min, Math.min(max, value + d));
}

// ---------------------------------------------------------------------------
// Info popover placement
// ---------------------------------------------------------------------------

export interface PopoverPlacement {
  /** Left edge of the popover relative to the trigger's left edge, in px. */
  offset: number;
  /** Width of the popover, in px. */
  width: number;
  /** Horizontal transform origin inside the popover (px), so it grows out of the trigger. */
  originX: number;
}

/**
 * Where an info popover goes so it stays `margin` px inside the viewport: under the trigger,
 * left-aligned when that fits, right-aligned when that fits, otherwise slid in to fit.
 * Decided from the room that is actually there, not from which half of the screen the trigger is in.
 */
export function placePopover(triggerLeft: number, triggerWidth: number, viewportWidth: number, maxWidth = 280, margin = 16): PopoverPlacement {
  const width = Math.max(0, Math.min(maxWidth, viewportWidth - 2 * margin));
  const triggerRight = triggerLeft + triggerWidth;
  let left: number;
  if (triggerLeft >= margin && triggerLeft + width <= viewportWidth - margin) left = triggerLeft;
  else if (triggerRight - width >= margin && triggerRight <= viewportWidth - margin) left = triggerRight - width;
  else left = Math.max(margin, Math.min(viewportWidth - margin - width, triggerLeft));
  const center = triggerLeft + triggerWidth / 2 - left;
  const originX = Math.max(16, Math.min(width - 16, center));
  return { offset: Math.round(left - triggerLeft), width, originX: Math.round(originX) };
}

// ---------------------------------------------------------------------------
// Product cards: price range and which chains sell it
// ---------------------------------------------------------------------------

/** Lowest and highest positive price, or null when nothing is priced. */
export function priceRange(prices: number[]): { min: number; max: number } | null {
  const ok = prices.filter((p) => Number.isFinite(p) && p > 0);
  if (!ok.length) return null;
  return { min: Math.min(...ok), max: Math.max(...ok) };
}

/** Chains once each, cheapest first (by their best price); chains without a price go last, in their original order. */
export function chainsByPrice<C extends string>(offers: Array<{ chain: C; priceCents: number }>): C[] {
  const best = new Map<C, number>();
  for (const o of offers) {
    const p = o.priceCents > 0 ? o.priceCents : Number.POSITIVE_INFINITY;
    const prev = best.get(o.chain);
    if (prev === undefined || p < prev) best.set(o.chain, p);
  }
  return [...best.entries()].sort((a, b) => (a[1] === b[1] ? 0 : a[1] < b[1] ? -1 : 1)).map(([c]) => c);
}

/** The first `limit` items and how many more there are ("+2"). When only one would hide, it is shown instead. */
export function takeWithMore<T>(items: T[], limit = 3): { shown: T[]; more: number } {
  if (items.length <= limit + 1) return { shown: items, more: 0 };
  return { shown: items.slice(0, limit), more: items.length - limit };
}
