import { describe, expect, it } from 'vitest';
import {
  createOpenFoodFacts, mapOffDetails, mapOffSearch, OFF_BASE, offProduct, tagLabel,
} from '../src/sources/live/openfoodfacts';
import { BlockedError, type AdapterCtx, type FetchKind } from '../src/sources/live/types';

// Fixtures are read with Node's fs, typed here so the Worker tsconfig needs no @types/node.
const FS = 'node:fs';
const { readFileSync } = (await import(FS)) as { readFileSync(p: URL, enc: 'utf8'): string };
const here = (import.meta as unknown as { url: string }).url;
const fixture = (rel: string): string => readFileSync(new URL(`./fixtures/${rel}`, here), 'utf8');

const SEARCH = fixture('openfoodfacts/search.json');
const DETAIL = fixture('openfoodfacts/detail.json');
const NOT_FOUND = fixture('openfoodfacts/detail-notfound.json');
const UNAVAILABLE = fixture('openfoodfacts/unavailable-503.html');

function fakeCtx(answer: (url: string) => Response, now = new Date('2026-11-15T18:35:00Z')) {
  const calls: Array<{ url: string; kind?: FetchKind }> = [];
  const ctx: AdapterCtx = {
    now,
    fetch: async (url, init) => {
      calls.push({ url, kind: init?.kind });
      return answer(url);
    },
  };
  return { ctx, calls };
}
const json = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'application/json' } });

describe('Open Food Facts search', () => {
  it('maps search hits to product cards keyed by EAN, without offers', () => {
    const cards = mapOffSearch(JSON.parse(SEARCH));
    expect(cards.map((c) => c.key)).toEqual(['ean:8410297012150', 'ean:8480000103826', 'ean:8410297111150']);
    expect(cards[0]).toEqual({
      key: 'ean:8410297012150',
      name: 'Leche Semidesnatada',
      brand: 'Central Lechera Asturiana',
      sizeText: '1l',
      ean: '8410297012150',
      image: 'https://images.openfoodfacts.org/images/products/841/029/701/2150/front_en.78.200.jpg',
      offers: [],
      details: { nutriscore: 'b', nova: 1, quantity: '1l' },
    });
    expect(cards[2]!.sizeText).toBe('1,5 L');
  });

  it('takes the Spanish name, the first brand, pads short EANs in the key and skips unusable hits', () => {
    expect(offProduct({ code: '12345670', product_name: 'Galletas', brands: 'Gullón, Otra', quantity: '200 g', nutriscore_grade: 'unknown' }))
      .toMatchObject({ key: 'ean:0000012345670', ean: '12345670', name: 'Galletas', brand: 'Gullón', image: null, details: { nutriscore: null, nova: null } });
    expect(offProduct({ code: '8410000000001', product_name: 'Milk', product_name_es: 'Leche', image_front_url: 'http://images.openfoodfacts.org/a.jpg' }))
      .toMatchObject({ name: 'Leche', image: 'https://images.openfoodfacts.org/a.jpg', brand: null, sizeText: null });
    expect(offProduct({ code: '', product_name: 'Sin código' })).toBeNull();
    expect(offProduct({ code: '8410000000001' })).toBeNull();
    expect(mapOffSearch({ products: [null, 'x', { code: '8410000000001', product_name: 'A' }, { code: '8410000000001', product_name: 'A otra vez' }] }))
      .toHaveLength(1);
    expect(mapOffSearch({ nope: true })).toEqual([]);
  });

  it('asks the legacy full-text search once, page 1 only, Spain, 12 results, as a search', async () => {
    const { ctx, calls } = fakeCtx(() => json(SEARCH));
    const cards = await createOpenFoodFacts().search('  Leche  Semidesnatada ', ctx);
    expect(cards).toHaveLength(3);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe('search');
    const url = new URL(calls[0]!.url);
    expect(`${url.origin}${url.pathname}`).toBe(`${OFF_BASE}/cgi/search.pl`);
    expect(url.searchParams.get('search_terms')).toBe('leche semidesnatada');
    expect(url.searchParams.get('page_size')).toBe('12');
    expect(url.searchParams.get('tag_0')).toBe('spain');
    expect(url.searchParams.get('json')).toBe('1');
    expect(url.searchParams.has('page')).toBe(false);
    expect(url.searchParams.get('fields')).toContain('product_name_es');
  });

  it('reports a 503 as an error and a 429 as blocked', async () => {
    const e503 = await createOpenFoodFacts().search('leche', fakeCtx(() => new Response(UNAVAILABLE, { status: 503 })).ctx).catch((e: unknown) => e);
    expect(e503).toBeInstanceOf(Error);
    expect(e503).not.toBeInstanceOf(BlockedError);
    expect(String(e503)).toMatch(/503/);
    await expect(createOpenFoodFacts().search('leche', fakeCtx(() => json('{}', 429)).ctx)).rejects.toBeInstanceOf(BlockedError);
  });

  it('keeps under the documented search rate inside an isolate', async () => {
    const off = createOpenFoodFacts({ searchesPerMinute: 2, readsPerMinute: 15 });
    const t0 = new Date('2026-11-15T18:35:00Z');
    const { ctx, calls } = fakeCtx(() => json(SEARCH), t0);
    await off.search('leche', ctx);
    await off.search('pan', ctx);
    await expect(off.search('huevos', ctx)).rejects.toThrow(/searches a minute/);
    expect(calls).toHaveLength(2);
    await off.search('huevos', { ...ctx, now: new Date(t0.getTime() + 61_000) });
    expect(calls).toHaveLength(3);
  });

  it('does not search for less than two characters', async () => {
    const { ctx, calls } = fakeCtx(() => json(SEARCH));
    expect(await createOpenFoodFacts().search(' a ', ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});

describe('Open Food Facts details', () => {
  it('maps a product to details: Nutri-Score, NOVA, ingredients, allergens in Spanish, categories, images', async () => {
    const { ctx, calls } = fakeCtx(() => json(DETAIL));
    const d = await createOpenFoodFacts().details('8410297012150', ctx);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.kind).toBe('detail');
    expect(calls[0]!.url.startsWith(`${OFF_BASE}/api/v2/product/8410297012150.json?fields=`)).toBe(true);
    expect(d).toEqual({
      nutriscore: 'b',
      nova: 1,
      ingredients: 'Leche semidesnatada',
      allergens: ['leche'],
      categories: ['dairies', 'milks liquid and powder', 'milks', 'homogenized milks', 'pasteurised products', 'semi skimmed milks', 'uht milks', 'cow milks'],
      quantity: '1l',
      images: [
        'https://images.openfoodfacts.org/images/products/841/029/701/2150/front_en.78.400.jpg',
        'https://images.openfoodfacts.org/images/products/841/029/701/2150/front_en.78.200.jpg',
      ],
    });
  });

  it('answers null for a 404 or status 0, and for something that is not a barcode (without asking)', async () => {
    expect(await createOpenFoodFacts().details('8410014486027', fakeCtx(() => json(NOT_FOUND, 404)).ctx)).toBeNull();
    expect(mapOffDetails(JSON.parse(NOT_FOUND))).toBeNull();
    const { ctx, calls } = fakeCtx(() => json(DETAIL));
    expect(await createOpenFoodFacts().details('abc', ctx)).toBeNull();
    expect(calls).toHaveLength(0);
  });

  it('reports a 503 as an error', async () => {
    const err = await createOpenFoodFacts().details('8410297012150', fakeCtx(() => new Response(UNAVAILABLE, { status: 503 })).ctx)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(BlockedError);
  });

  it('labels tags without their language prefix', () => {
    expect(tagLabel('en:sesame-seeds', { 'sesame-seeds': 'sésamo' })).toBe('sésamo');
    expect(tagLabel('es:avellanas')).toBe('avellanas');
    expect(tagLabel('en:semi-skimmed-milks')).toBe('semi skimmed milks');
    expect(mapOffDetails({ status: 1, product: { allergens_tags: ['en:gluten', 'en:milk', 'en:milk', 'fr:lait'], nova_group: '4', nutriscore_grade: 'E' } }))
      .toMatchObject({ allergens: ['gluten', 'leche', 'lait'], nova: 4, nutriscore: 'e', ingredients: null, images: [] });
  });
});
