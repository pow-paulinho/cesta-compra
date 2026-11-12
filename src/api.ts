import { matchKey } from './match';
import { checkout, type CartItem, type Prices } from './split';
import { isStale } from './store';

export interface PriceRow { ean: string; name: string; brand: string | null; size: string | null; chain: string; source: string; price_cents: number; observed_on: string; place: string | null }

/** Search: products whose name or brand matches, each with every known price. Demo and real prices stay apart. */
export async function searchProducts(db: D1Database, q: string, now = new Date()) {
  const term = q.trim().toLowerCase();
  if (term.length < 2) return { products: [] };
  const like = likePattern(term);
  const rows = await db.prepare(`SELECT p.ean, p.name, p.brand, p.size, x.chain, x.source, x.price_cents, x.observed_on, x.place
    FROM products p JOIN prices x ON x.ean = p.ean
    WHERE p.ean IN (SELECT ean FROM products WHERE lower(name) LIKE ?1 ESCAPE '\\' OR lower(coalesce(brand,'')) LIKE ?1 ESCAPE '\\' OR ean = ?2 LIMIT 30)
    ORDER BY p.name, x.price_cents`).bind(like, term).all<PriceRow>();
  const byEan = new Map<string, { ean: string; name: string; brand: string | null; size: string | null; match: string; prices: unknown[] }>();
  for (const r of rows.results) {
    const p = byEan.get(r.ean) ?? { ean: r.ean, name: r.name, brand: r.brand, size: r.size, match: matchKey(r).confidence, prices: [] };
    p.prices.push({ chain: r.chain, source: r.source, cents: r.price_cents, date: r.observed_on, place: r.place, stale: isStale(r.observed_on, now) });
    byEan.set(r.ean, p);
  }
  return { products: [...byEan.values()] };
}

/** The LIKE pattern for a search term, with its own wildcards escaped. */
export function likePattern(term: string): string {
  return `%${term.trim().toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Prices for a cart. `source` picks demo or real prices; they are never mixed in one plan. */
export async function cartPrices(db: D1Database, eans: string[], source: 'demo' | 'open_prices'): Promise<Prices> {
  const clean = [...new Set(eans.filter((e) => /^\d{8,14}$/.test(e)))].slice(0, 60);
  const prices: Prices = {};
  if (!clean.length) return prices;
  const rows = await db.prepare(`SELECT ean, chain, price_cents FROM prices WHERE source = ?1 AND ean IN (${clean.map((_, i) => `?${i + 2}`).join(',')})`)
    .bind(source, ...clean).all<{ ean: string; chain: string; price_cents: number }>();
  for (const r of rows.results) (prices[r.ean] ??= {})[r.chain] = r.price_cents;
  return prices;
}

export function parseCart(body: unknown): { items: CartItem[]; maxStores: number; source: 'demo' | 'open_prices' } | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (!Array.isArray(b.items) || b.items.length > 60) return null;
  const items: CartItem[] = [];
  for (const it of b.items) {
    const i = it as Record<string, unknown>;
    if (typeof i?.ean !== 'string' || !/^\d{8,14}$/.test(i.ean)) return null;
    const qty = Number(i.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) return null;
    items.push({ ean: i.ean, qty });
  }
  const maxStores = b.maxStores === undefined ? 7 : Number(b.maxStores);
  if (!Number.isInteger(maxStores) || maxStores < 1 || maxStores > 7) return null;
  const source = b.source === 'open_prices' ? 'open_prices' : 'demo';
  return { items, maxStores, source };
}

export async function checkoutCart(db: D1Database, body: unknown) {
  const cart = parseCart(body);
  if (!cart) return null;
  const prices = await cartPrices(db, cart.items.map((i) => i.ean), cart.source);
  return { source: cart.source, maxStores: cart.maxStores, ...checkout(cart.items, prices, cart.maxStores) };
}
