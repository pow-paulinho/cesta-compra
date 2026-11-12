import { describe, expect, it } from 'vitest';
import { DEMO_PRODUCTS } from '../src/sources/demo-products';
import { DEMO_CHAINS, demoPrices } from '../src/sources/demo';
import { isStale } from '../src/store';

describe('demo prices', () => {
  it('are stable, near the reference price, and leave every product in at least three chains', () => {
    const a = demoPrices();
    expect(demoPrices()).toEqual(a);
    expect(DEMO_PRODUCTS.length).toBeGreaterThanOrEqual(50);
    for (const p of DEMO_PRODUCTS) {
      const mine = a.filter((x) => x.ean === p.ean);
      expect(mine.length).toBeGreaterThanOrEqual(DEMO_CHAINS.length - 2);
      for (const x of mine) {
        expect(x.priceCents).toBeGreaterThanOrEqual(Math.floor(p.refPrice * 92));
        expect(x.priceCents).toBeLessThanOrEqual(Math.ceil(p.refPrice * 112));
      }
    }
  });

  it('marks prices older than 30 days as stale', () => {
    const now = new Date('2026-11-11T10:00:00Z');
    expect(isStale('2026-10-20', now)).toBe(false);
    expect(isStale('2026-10-01', now)).toBe(true);
  });
});
