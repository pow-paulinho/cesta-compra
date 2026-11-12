import { matchKey } from './match';
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
