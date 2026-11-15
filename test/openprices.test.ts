import { describe, expect, it } from 'vitest';
import { CHAINS, chainOf, DEFAULT_PLAN, fetchOpenPrices, isSpain, toPrice, USER_AGENT } from '../src/sources/openprices';

const item = (over: Record<string, unknown> = {}) => ({
  product_code: '8410014477743', price: 3.99, currency: 'EUR', date: '2025-11-10',
  product: { product_name: 'Nocilla Original', brands: 'Nocilla, Idilia', product_quantity: 360, product_quantity_unit: 'g' }, ...over,
});

describe('Open Prices', () => {
  it('keeps only Spanish locations of our chains', () => {
    expect(isSpain('España')).toBe(true);
    expect(isSpain('France')).toBe(false);
    expect(chainOf('Mercadona')).toBe('Mercadona');
    expect(chainOf('Supermercados Dia')).toBe('Dia');
    expect(chainOf('Diagonal Mar')).toBeNull();
  });

  it('recognises Aldi, Ahorramas, BM and El Corte Inglés by whole words', () => {
    expect(chainOf('ALDI')).toBe('Aldi');
    expect(chainOf('Ahorramas')).toBe('Ahorramas');
    expect(chainOf('BM')).toBe('BM');
    expect(chainOf('BM Supermercados')).toBe('BM');
    expect(chainOf('Supermercados BM')).toBe('BM');
    expect(chainOf('El Corte Inglés')).toBe('El Corte Inglés');
    expect(chainOf('Hipercor El Corte Ingles')).toBe('El Corte Inglés');
    expect(chainOf('Supermercado Día')).toBe('Dia');
    // BM must not match words that merely contain "bm".
    expect(chainOf('BMW Motorrad')).toBeNull();
    expect(chainOf('Ambmar')).toBeNull();
    expect(chainOf('Gasolinera Abm')).toBeNull();
    expect(chainOf('Aldiana')).toBeNull();
  });

  it('turns an item into a price in cents with its date', () => {
    expect(toPrice(item(), 'Dia', 'Madrid')).toEqual({
      ean: '8410014477743', name: 'Nocilla Original', brand: 'Nocilla', size: '360 g',
      chain: 'Dia', priceCents: 399, observedOn: '2025-11-10', place: 'Madrid',
    });
  });

  it('skips what cannot be compared', () => {
    expect(toPrice(item({ product_code: null }), 'Dia', null)).toBeNull();
    expect(toPrice(item({ currency: 'USD' }), 'Dia', null)).toBeNull();
    expect(toPrice(item({ price: 0 }), 'Dia', null)).toBeNull();
    expect(toPrice(item({ date: null }), 'Dia', null)).toBeNull();
  });

  it('is polite: one request at a time, a pause between them, an honest user-agent and a cap', async () => {
    const calls: string[] = [];
    const waits: number[] = [];
    const fake = (async (url: string, init?: RequestInit) => {
      calls.push(url);
      expect((init?.headers as Record<string, string>)['user-agent']).toBe(USER_AGENT);
      if (url.includes('/locations')) {
        return Response.json({ items: [{ id: 7, osm_name: 'Mercadona', osm_address_country: 'España', osm_address_city: 'León', price_count: 3 }] });
      }
      return Response.json({ items: [item(), item({ product_code: null })] });
    }) as unknown as typeof fetch;
    const r = await fetchOpenPrices(fake, { maxRequests: 3, locationsPerChain: 2, delayMs: 1100 }, async (ms) => { waits.push(ms); });
    expect(r.requests).toBe(3);
    expect(calls).toHaveLength(3);
    expect(calls.every((u) => u.startsWith('https://prices.openfoodfacts.org/api/v1/'))).toBe(true);
    expect(waits).toEqual([1100, 1100]);
    expect(r.prices).toHaveLength(1);
    expect(r.skipped).toBe(1);
  });

  it('pages through the worldwide locations, up to the last page and never past 8 per chain', async () => {
    const pagesOf: Record<string, number> = { Carrefour: 5, Lidl: 12 };
    const asked: Record<string, number[]> = {};
    const priced: number[] = [];
    const fake = (async (url: string) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/locations')) {
        const like = u.searchParams.get('osm_name__like')!;
        const page = Number(u.searchParams.get('page'));
        (asked[like] ??= []).push(page);
        const pages = pagesOf[like] ?? 1;
        const id = like.length * 1000 + page;
        // Each page: one foreign store and one Spanish one; only the last page has the busiest Spanish store.
        return Response.json({
          page, pages, size: 100, total: pages * 2,
          items: [
            { id: id + 500, osm_name: like, osm_address_country: 'France', price_count: 99 },
            { id, osm_name: like, osm_address_country: 'España', osm_address_city: `p${page}`, price_count: page === Math.min(pages, 8) ? 50 : 1 },
          ],
        });
      }
      priced.push(Number(u.searchParams.get('location_id')));
      return Response.json({ items: [] });
    }) as unknown as typeof fetch;
    const r = await fetchOpenPrices(fake, { maxRequests: 500, locationsPerChain: 1, delayMs: 0 }, async () => {});
    expect(asked['Carrefour']).toEqual([1, 2, 3, 4, 5]);
    expect(asked['Lidl']).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(asked['Mercadona']).toEqual([1]);
    expect(asked['Corte Ingl']).toEqual([1]);
    // The busiest Spanish Carrefour was on page 5, the busiest Lidl on page 8: both are the one priced.
    expect(priced).toContain('Carrefour'.length * 1000 + 5);
    expect(priced).toContain('Lidl'.length * 1000 + 8);
    expect(priced).not.toContain('Carrefour'.length * 1000 + 5 + 500);
    expect(r.requests).toBe(Object.values(asked).flat().length + priced.length);
  });

  it('stops paging at the request cap', async () => {
    let calls = 0;
    const fake = (async () => {
      calls += 1;
      return Response.json({ pages: 8, items: [{ id: calls, osm_name: 'Mercadona', osm_address_country: 'España', price_count: 1 }] });
    }) as unknown as typeof fetch;
    const r = await fetchOpenPrices(fake, { maxRequests: 5, locationsPerChain: 4, delayMs: 0 }, async () => {});
    expect(calls).toBe(5);
    expect(r.requests).toBe(5);
  });

  it('fits a full daily run of every chain in the default cap of 90 requests', async () => {
    expect(DEFAULT_PLAN).toMatchObject({ maxRequests: 90, delayMs: 1100, locationsPerChain: 4, maxLocationPages: 8 });
    // Location pages as Open Prices had them on 2026-11-15 (Carrefour 5, Lidl 7, Aldi 3, the rest 1).
    const pagesOf: Record<string, number> = { Carrefour: 5, Lidl: 7, Aldi: 3 };
    const chainsPriced = new Set<string>();
    const fake = (async (url: string) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/locations')) {
        const like = u.searchParams.get('osm_name__like')!;
        const name = like === 'Corte Ingl' ? 'El Corte Inglés' : like;
        const page = Number(u.searchParams.get('page'));
        const items = Array.from({ length: 5 }, (_, k) => ({
          id: name.length * 10_000 + page * 10 + k, osm_name: name, osm_address_country: 'España', osm_address_city: name, price_count: 3,
        }));
        return Response.json({ page, pages: pagesOf[name] ?? 1, items });
      }
      return Response.json({ items: [{ product_code: '8410014477743', price: 1.5, currency: 'EUR', date: '2026-11-10', product: { product_name: 'X' } }] });
    }) as unknown as typeof fetch;
    const r = await fetchOpenPrices(fake, DEFAULT_PLAN, async () => {});
    for (const p of r.prices) chainsPriced.add(p.chain);
    expect([...chainsPriced].sort()).toEqual([...CHAINS].sort());
    expect(r.requests).toBeLessThanOrEqual(90);
    expect(r.requests).toBe((11 - 3) + 5 + 7 + 3 + 11 * 4);
  });
});
