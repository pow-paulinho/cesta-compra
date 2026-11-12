import { DEMO_PRODUCTS, type DemoProduct } from './demo-products';

export const DEMO_CHAINS = ['Mercadona', 'Dia', 'Consum', 'Carrefour', 'Alcampo'] as const;
/** The date demo prices carry. Fixed, so the UI can say exactly what they are. */
export const DEMO_DATE = '2026-11-01';

/** A small stable hash, so the same product gets the same demo prices on every run. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export interface DemoPrice { ean: string; chain: string; priceCents: number }

/**
 * One demo price per product and chain: the reference price times a factor
 * between -8% and +12%, rounded to the cent. About one product in six is
 * missing from each chain, never from more than two, so a cart needs a split.
 */
export function demoPrices(products: DemoProduct[] = DEMO_PRODUCTS): DemoPrice[] {
  const out: DemoPrice[] = [];
  for (const p of products) {
    const missing = DEMO_CHAINS.filter((c) => hash(`${p.ean}:${c}:missing`) % 6 === 0).slice(0, 2);
    for (const chain of DEMO_CHAINS) {
      if (missing.includes(chain)) continue;
      const factor = 0.92 + (hash(`${p.ean}:${chain}`) % 2001) / 10000;
      out.push({ ean: p.ean, chain, priceCents: Math.max(1, Math.round(p.refPrice * 100 * factor)) });
    }
  }
  return out;
}
