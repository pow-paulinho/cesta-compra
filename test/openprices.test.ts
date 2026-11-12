import { describe, expect, it } from 'vitest';
import { chainOf, fetchOpenPrices, isSpain, toPrice, USER_AGENT } from '../src/sources/openprices';

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
});
