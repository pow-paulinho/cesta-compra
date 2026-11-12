import { describe, expect, it } from 'vitest';
import { likePattern, searchProducts } from '../src/api';

/** A D1 stand-in that records the bound values and returns fixed rows. */
function fakeDb(rows: unknown[]) {
  const bound: unknown[][] = [];
  const db = {
    prepare: () => ({ bind: (...v: unknown[]) => { bound.push(v); return { all: async () => ({ results: rows }) }; } }),
  } as unknown as D1Database;
  return { db, bound };
}

describe('product search', () => {
  it('escapes LIKE wildcards in the term', () => {
    expect(likePattern('50%_x')).toBe('%50\\%\\_x%');
  });

  it('answers nothing for fewer than 2 characters, without a query', async () => {
    const { db, bound } = fakeDb([]);
    expect(await searchProducts(db, ' a ')).toEqual({ products: [] });
    expect(bound).toHaveLength(0);
  });

  it('groups prices by product with source, date and the stale flag', async () => {
    const rows = [
      { ean: '8076809579346', name: 'Pesto alla genovese', brand: 'Barilla', size: '190 g', chain: 'Consum', source: 'open_prices', price_cents: 299, observed_on: '2026-02-06', place: 'València' },
      { ean: '8076809579346', name: 'Pesto alla genovese', brand: 'Barilla', size: '190 g', chain: 'Dia', source: 'demo', price_cents: 289, observed_on: '2026-11-01', place: null },
    ];
    const { db } = fakeDb(rows);
    const r = await searchProducts(db, 'pesto', new Date('2026-11-12T00:00:00Z'));
    expect(r.products).toHaveLength(1);
    expect(r.products[0]).toMatchObject({ ean: '8076809579346', match: 'ean' });
    expect(r.products[0]!.prices).toEqual([
      { chain: 'Consum', source: 'open_prices', cents: 299, date: '2026-02-06', place: 'València', stale: true },
      { chain: 'Dia', source: 'demo', cents: 289, date: '2026-11-01', place: null, stale: false },
    ]);
  });
});
