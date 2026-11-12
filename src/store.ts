import type { OpenPrice } from './sources/openprices';
import { DEMO_PRODUCTS } from './sources/demo-products';
import { DEMO_DATE, demoPrices } from './sources/demo';

/** Days after which a price is shown as stale. */
export const STALE_DAYS = 30;

export function isStale(observedOn: string, now: Date): boolean {
  const t = Date.parse(`${observedOn}T00:00:00Z`);
  return Number.isFinite(t) && now.getTime() - t > STALE_DAYS * 86_400_000;
}

export async function seedDemo(db: D1Database): Promise<number> {
  const stmts: D1PreparedStatement[] = [];
  for (const p of DEMO_PRODUCTS) {
    stmts.push(db.prepare('INSERT INTO products (ean, name, brand, size) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(ean) DO NOTHING')
      .bind(p.ean, p.name, p.brand, p.size || null));
  }
  const prices = demoPrices();
  for (const p of prices) {
    stmts.push(db.prepare(`INSERT INTO prices (ean, chain, source, price_cents, observed_on, place) VALUES (?1, ?2, 'demo', ?3, ?4, NULL)
      ON CONFLICT(ean, chain, source) DO UPDATE SET price_cents = excluded.price_cents, observed_on = excluded.observed_on`)
      .bind(p.ean, p.chain, p.priceCents, DEMO_DATE));
  }
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
  return prices.length;
}

export async function saveOpenPrices(db: D1Database, prices: OpenPrice[]): Promise<number> {
  // Keep the newest observation per product and chain.
  const newest = new Map<string, OpenPrice>();
  for (const p of prices) {
    const k = `${p.ean}|${p.chain}`;
    const cur = newest.get(k);
    if (!cur || p.observedOn > cur.observedOn) newest.set(k, p);
  }
  const stmts: D1PreparedStatement[] = [];
  for (const p of newest.values()) {
    stmts.push(db.prepare('INSERT INTO products (ean, name, brand, size) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(ean) DO NOTHING')
      .bind(p.ean, p.name, p.brand, p.size));
    stmts.push(db.prepare(`INSERT INTO prices (ean, chain, source, price_cents, observed_on, place) VALUES (?1, ?2, 'open_prices', ?3, ?4, ?5)
      ON CONFLICT(ean, chain, source) DO UPDATE SET price_cents = excluded.price_cents, observed_on = excluded.observed_on, place = excluded.place
      WHERE excluded.observed_on >= prices.observed_on`)
      .bind(p.ean, p.chain, p.priceCents, p.observedOn, p.place));
  }
  for (let i = 0; i < stmts.length; i += 90) await db.batch(stmts.slice(i, i + 90));
  return newest.size;
}

export async function logImport(db: D1Database, source: string, requests: number, prices: number, skipped: number, at: Date): Promise<void> {
  await db.prepare('INSERT INTO imports (source, at, requests, prices, skipped) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(source, at.toISOString(), requests, prices, skipped).run();
}

export async function status(db: D1Database) {
  const counts = await db.prepare(`SELECT source, chain, COUNT(*) AS n, MAX(observed_on) AS newest FROM prices GROUP BY source, chain ORDER BY source, chain`).all();
  const last = await db.prepare('SELECT source, at, requests, prices, skipped FROM imports ORDER BY id DESC LIMIT 3').all();
  const products = await db.prepare('SELECT COUNT(*) AS n FROM products').first<{ n: number }>();
  return { products: products?.n ?? 0, prices: counts.results, imports: last.results };
}
