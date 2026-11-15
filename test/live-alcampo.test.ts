import { describe, expect, it } from 'vitest';
import {
  ALCAMPO_BASE, alcampo, alcampoSlug, alcampoUnit, parseAlcampoState, readPageStates, toCents,
} from '../src/sources/live/alcampo';
import { BlockedError, type AdapterCtx, type FetchKind } from '../src/sources/live/types';

// Fixtures are read with Node's fs, typed here so the Worker tsconfig needs no @types/node.
const FS = 'node:fs';
const { readFileSync } = (await import(FS)) as { readFileSync(p: URL, enc: 'utf8'): string };
const here = (import.meta as unknown as { url: string }).url;
const fixture = (rel: string): string => readFileSync(new URL(`./fixtures/${rel}`, here), 'utf8');

const PRODUCT_PAGE = fixture('alcampo/product-page.html');
const BLOCKED_403 = fixture('alcampo/blocked-403.html');
const NOW = new Date('2026-11-15T18:03:00Z');

function fakeCtx(answer: (url: string) => Response) {
  const calls: Array<{ url: string; kind?: FetchKind }> = [];
  const ctx: AdapterCtx = {
    now: NOW,
    fetch: async (url, init) => {
      calls.push({ url, kind: init?.kind });
      return answer(url);
    },
  };
  return { ctx, calls };
}

const html = (body: string, status = 200) => new Response(body, { status, headers: { 'content-type': 'text/html' } });

describe('Alcampo page state', () => {
  it('reads the product from the product page we saw (price, unit price, size, image, id, link)', () => {
    const offers = parseAlcampoState(PRODUCT_PAGE, NOW);
    expect(offers).toHaveLength(1);
    const canonical = /rel="canonical" href="([^"]+)"/.exec(PRODUCT_PAGE)![1];
    expect(offers[0]).toEqual({
      chain: 'alcampo',
      id: '52601',
      name: 'PULEVA Peques 3 Leche (3) de crecimiento con cereales, de 12 a 36 meses 6 x 1 l.',
      brand: 'PULEVA',
      ean: null,
      sizeText: '6000ml',
      priceCents: 1128,
      unitPriceCents: 188,
      unit: 'l',
      image: 'https://www.compraonline.alcampo.es/images-v3/37ea0506-72ec-4543-93c8-a77bb916ec12/19cf97c4-71c5-4a69-b714-cf2fcfb68361/300x300.jpg',
      url: canonical,
      promo: null,
      source: 'live',
      observedOn: '2026-11-15',
    });
  });

  it('finds every window.__…__ state, even followed by ";" and other statements, or inside JSON.parse', () => {
    const page = '<script>window.__INITIAL_STATE__ = {"a":"}{\\"x","b":[1,{"c":"<\\u002Fscript>"}]};window.foo=1;</script>'
      + '<script>window.__QUERY_INITIAL_STATE__=JSON.parse("{\\"q\\":[2]}");</script>'
      + '<script>window.__BROKEN__={"never closed": [</script>';
    expect(readPageStates(page)).toEqual([
      { name: '__INITIAL_STATE__', value: { a: '}{"x', b: [1, { c: '</script>' }] } },
      { name: '__QUERY_INITIAL_STATE__', value: { q: [2] } },
    ]);
    expect(readPageStates(BLOCKED_403)).toEqual([]);
  });

  it('walks any state shape: first 12, de-duplicated, bad products skipped, units mapped', () => {
    const entity = (i: number, over: Record<string, unknown> = {}) => ({
      productId: `p-${i}`, retailerProductId: String(1000 + i), name: `Leche semidesnatada ${i} 1 L`, brand: 'Marca',
      packSizeDescription: '1 l', price: { amount: '0.95', currency: 'EUR' }, image: { src: `/images-v3/x/${i}/300x300.jpg` }, ...over,
    });
    const entities = {
      a: entity(1, { unitPrice: { price: { amount: '0.79', currency: 'EUR' }, unit: 'fop.price.per.100gram' }, packSizeDescription: '250 g' }),
      b: entity(2, { unitPrice: { price: { amount: '3.50', currency: 'EUR' }, unit: 'per.kilogram' } }),
      c: entity(3, { unitPrice: { price: { amount: '0.25', currency: 'EUR' }, unit: 'fop.price.per.each' }, promotions: [{ description: '2ª unidad <b>-50%</b>' }] }),
      dup: entity(1, { price: { amount: '9.99', currency: 'EUR' } }),
      noPrice: entity(4, { price: { amount: 'gratis', currency: 'EUR' } }),
      dollars: entity(5, { price: { amount: '1.00', currency: 'USD' } }),
      noName: entity(6, { name: '   ' }),
      computed: entity(7, { packSizeDescription: '500 g', price: { amount: '2', currency: 'EUR' } }),
      ...Object.fromEntries(Array.from({ length: 10 }, (_, k) => [`more${k}`, entity(20 + k)])),
    };
    const page = `<script>window.__INITIAL_STATE__={"data":{"products":{"productEntities":${JSON.stringify(entities)}}}};</script>`;
    const offers = parseAlcampoState(page, NOW);
    expect(offers).toHaveLength(12);
    expect(new Set(offers.map((o) => o.id)).size).toBe(12);
    const byId = Object.fromEntries(offers.map((o) => [o.id, o]));
    expect(byId['1001']).toMatchObject({ priceCents: 95, unitPriceCents: 790, unit: 'kg', sizeText: '250 g' });
    expect(byId['1002']).toMatchObject({ unitPriceCents: 350, unit: 'kg' });
    expect(byId['1003']).toMatchObject({ unitPriceCents: 25, unit: 'ud', promo: '2ª unidad -50%' });
    expect(byId['1007']).toMatchObject({ priceCents: 200, unitPriceCents: 400, unit: 'kg' });
    expect(byId['1001']!.image).toBe(`${ALCAMPO_BASE}/images-v3/x/1/300x300.jpg`);
    expect(byId['1001']!.url).toBe(`${ALCAMPO_BASE}/products/leche-semidesnatada-1-1-l/1001`);
    for (const bad of ['1004', '1005', '1006']) expect(byId[bad]).toBeUndefined();
  });

  it('maps Ocado unit keys and prices', () => {
    expect(alcampoUnit('fop.price.per.litre')).toEqual({ unit: 'l', factor: 1 });
    expect(alcampoUnit('fop.price.per.kg')).toEqual({ unit: 'kg', factor: 1 });
    expect(alcampoUnit('per.kilogram')).toEqual({ unit: 'kg', factor: 1 });
    expect(alcampoUnit('fop.price.per.100ml')).toEqual({ unit: 'l', factor: 10 });
    expect(alcampoUnit('fop.price.per.75cl')).toEqual({ unit: 'l', factor: 100 / 75 });
    expect(alcampoUnit('unit')).toEqual({ unit: 'ud', factor: 1 });
    expect(alcampoUnit('fop.price.per.dozen')).toEqual({ unit: 'ud', factor: 1 / 12 });
    expect(alcampoUnit('fop.price.per.wash')).toBeNull();
    expect(toCents('11.28')).toBe(1128);
    expect(toCents('1,05 €')).toBe(105);
    expect(toCents('0')).toBeNull();
    expect(alcampoSlug('Agua mineral Font Vella, 6 x 1,5 l. Ñ')).toBe('agua-mineral-font-vella-6-x-1-5-l-n');
  });
});

describe('Alcampo search', () => {
  it('asks /search?q= once, as a search, and reads the offers from the page', async () => {
    const { ctx, calls } = fakeCtx(() => html(PRODUCT_PAGE));
    const offers = await alcampo.search('  leche   semidesnatada ', ctx);
    expect(calls).toEqual([{ url: `${ALCAMPO_BASE}/search?q=leche%20semidesnatada`, kind: 'search' }]);
    expect(offers.map((o) => o.id)).toEqual(['52601']);
  });

  it('turns the CloudFront 403 we got from the cloud into BlockedError', async () => {
    const { ctx } = fakeCtx(() => html(BLOCKED_403, 403));
    const err = await alcampo.search('leche semidesnatada', ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(BlockedError);
    expect((err as BlockedError).status).toBe(403);
  });

  it('treats 429 and challenge pages as blocked, other failures as errors', async () => {
    await expect(alcampo.search('leche', fakeCtx(() => html('slow down', 429)).ctx)).rejects.toBeInstanceOf(BlockedError);
    await expect(alcampo.search('leche', fakeCtx(() => html('<script>window.gokuProps={}</script>captcha', 202)).ctx))
      .rejects.toBeInstanceOf(BlockedError);
    await expect(alcampo.search('leche', fakeCtx(() => html(BLOCKED_403, 405)).ctx)).rejects.toBeInstanceOf(BlockedError);
    const e500 = await alcampo.search('leche', fakeCtx(() => html('oops', 500)).ctx).catch((e: unknown) => e);
    expect(e500).toBeInstanceOf(Error);
    expect(e500).not.toBeInstanceOf(BlockedError);
    const noState = await alcampo.search('leche', fakeCtx(() => html('<html>maintenance</html>')).ctx).catch((e: unknown) => e);
    expect(noState).not.toBeInstanceOf(BlockedError);
    expect(String(noState)).toMatch(/without product state/);
  });

  it('answers no offers for an empty query without calling the site', async () => {
    const { ctx, calls } = fakeCtx(() => html(PRODUCT_PAGE));
    expect(await alcampo.search('   ', ctx)).toEqual([]);
    expect(calls).toHaveLength(0);
  });
});
