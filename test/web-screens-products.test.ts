/**
 * web/src/lib/products.ts: the product cache is a store the open product sheet subscribes to,
 * so offers that stream in after the sheet opened reach it (finding weblogic-7).
 */
import { describe, expect, it, vi } from 'vitest';
import type { Offer, Product } from '../src/shared/types';
import { findProduct, mergeInto, mergeProduct, rememberProducts, subscribeProducts } from '../web/src/lib/products';

vi.mock('@shared/types', () => import('../src/shared/types'));

const offer = (chain: Offer['chain'], priceCents: number, source: Offer['source'] = 'live'): Offer =>
  ({ chain, id: `${chain}-1`, name: 'Leche', priceCents, source, observedOn: '2026-11-15' }) as Offer;

const product = (over: Partial<Product> = {}): Product => ({
  key: 'ean:8410000000001',
  name: 'Leche semidesnatada',
  brand: null,
  sizeText: null,
  ean: null,
  image: null,
  offers: [],
  ...over,
});

describe('the products store', () => {
  it('tells subscribers when a later source adds offers to a product they show', () => {
    const key = 'ean:8410000000011';
    rememberProducts([product({ key, offers: [offer('ahorramas', 125)] })]);
    const seen = vi.fn();
    const off = subscribeProducts(seen);
    rememberProducts([product({ key, offers: [offer('aldi', 114)] })]);
    off();
    expect(seen).toHaveBeenCalledTimes(1);
    expect(findProduct(key)!.offers.map((o) => o.chain)).toEqual(['ahorramas', 'aldi']);
  });

  it('stays quiet and keeps the same object when a sighting adds nothing', () => {
    const key = 'ean:8410000000012';
    rememberProducts([product({ key, offers: [offer('aldi', 114)] })]);
    const before = findProduct(key);
    const seen = vi.fn();
    const off = subscribeProducts(seen);
    rememberProducts([product({ key, offers: [offer('aldi', 114)] })]);
    off();
    expect(seen).not.toHaveBeenCalled();
    expect(findProduct(key)).toBe(before);
  });

  it('fills the gaps a later sighting knows: ean, brand, image and details', () => {
    const key = 'name:leche entera';
    rememberProducts([product({ key, details: { nutriscore: 'b' } })]);
    rememberProducts([product({ key, ean: '8410000000013', brand: 'Pascual', image: 'https://x/y.jpg', details: { nutriscore: 'c', nova: 1 } })]);
    const p = findProduct(key)!;
    expect(p.ean).toBe('8410000000013');
    expect(p.brand).toBe('Pascual');
    expect(p.image).toBe('https://x/y.jpg');
    // The first sighting wins per field; new fields are added.
    expect(p.details).toEqual({ nutriscore: 'b', nova: 1 });
  });

  it('forgets nothing it has not seen', () => {
    expect(findProduct('ean:0000000000000')).toBeNull();
  });
});

describe('merging sightings', () => {
  it('joins offers without duplicates', () => {
    const a = product({ offers: [offer('aldi', 114)] });
    const b = product({ offers: [offer('aldi', 114), offer('lidl', 109, 'open_prices')] });
    expect(mergeProduct(a, b).offers.map((o) => o.chain)).toEqual(['aldi', 'lidl']);
  });

  it('returns the same product and list when nothing is new (no needless re-renders)', () => {
    const a = product({ offers: [offer('aldi', 114)], details: { nutriscore: 'a' } });
    expect(mergeProduct(a, product({ offers: [offer('aldi', 114)], details: { nutriscore: 'b' } }))).toBe(a);
    const list = [a];
    expect(mergeInto(list, product({ offers: [offer('aldi', 114)] }))).toBe(list);
    expect(mergeInto(list, product({ key: 'ean:other' }))).toHaveLength(2);
  });
});
