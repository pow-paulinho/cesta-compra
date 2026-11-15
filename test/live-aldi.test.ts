import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  aldi, aldiAllows, aldiProductToOffer, ALDI_MAX_DETAILS, ALDI_SITEMAP_URL, parseAldiCategoryPage, parseAldiProductPage,
} from '../src/sources/live/aldi';
import { clearSitemapCache } from '../src/sources/live/sitemap';
import { BlockedError, type AdapterCtx, type FetchKind } from '../src/sources/live/types';

const fixture = (p: string) => readFileSync(new URL(`./fixtures/aldi/${p}`, import.meta.url), 'utf8');
const SITEMAP = fixture('sitemap-products.xml');
const PRODUCT = fixture('product-leche-entera-80000.html');
const CATEGORY = fixture('category-leche-y-bebidas-vegetales.html');
const NOW = new Date('2026-11-15T12:00:00Z');
const euros = (s: string) => s.replace(/ €/g, '\u00a0€');

/** A product page for another product, made from the real one by swapping the id and slug. */
const pageFor = (url: string) => {
  const m = /producto\/(.+)-(\d+)\.html$/.exec(url)!;
  return PRODUCT.replaceAll('leche-entera-80000', `${m[1]}-${m[2]}`).replaceAll('\\"80000\\"', `\\"${m[2]}\\"`);
};

function fakeCtx(respond: (url: string, kind?: FetchKind) => Response | Promise<Response>, now = NOW) {
  const calls: Array<{ url: string; kind?: FetchKind }> = [];
  const ctx: AdapterCtx = {
    now,
    fetch: async (url, init) => {
      calls.push({ url, kind: init?.kind });
      return respond(url, init?.kind);
    },
  };
  return { ctx, calls };
}
const siteResponder = (detail: (url: string) => Response = (url) => new Response(pageFor(url))) => (url: string) =>
  url === ALDI_SITEMAP_URL ? new Response(SITEMAP, { headers: { 'content-type': 'application/xml' } }) : detail(url);

beforeEach(() => clearSitemapCache());

describe('parseAldiProductPage', () => {
  it('reads PRODUCT_DETAIL_GET from __NEXT_DATA__.apiData (a JSON string)', () => {
    expect(parseAldiProductPage(PRODUCT, NOW)).toEqual({
      chain: 'aldi',
      id: '80000',
      name: 'Leche entera',
      brand: 'Milsani',
      ean: null,
      sizeText: '1 L',
      priceCents: 96,
      unitPriceCents: 96, // no basePrice on the page: computed from "1 l unidad"
      unit: 'l',
      image: 'https://s7g10.scene7.com/is/image/aldinord/800_pack_0_0_es_es_leche_entera_brick_2026_cw07',
      url: 'https://www.aldi.es/producto/leche-entera-80000.html',
      promo: null,
      source: 'live',
      observedOn: '2026-11-15',
    });
  });

  it('returns null, never throws, on pages it cannot read', () => {
    expect(parseAldiProductPage('<html><body>Hola</body></html>', NOW)).toBeNull();
    expect(parseAldiProductPage('<script id="__NEXT_DATA__" type="application/json">{not json</script>', NOW)).toBeNull();
    const badApi = PRODUCT.replace(/"apiData":"[^]*?"\},"__N_SSP"/, '"apiData":"[[oops"},"__N_SSP"');
    expect(parseAldiProductPage(badApi, NOW)).toBeNull();
    const noPrice = PRODUCT.replace('\\"priceValue\\":0.96', '\\"priceValue\\":null');
    expect(parseAldiProductPage(noPrice, NOW)).toBeNull();
  });
});

describe('parseAldiCategoryPage', () => {
  const offers = parseAldiCategoryPage(CATEGORY, NOW);
  const byId = (id: string) => offers.find((o) => o.id === id)!;

  it('reads every hit of the Algolia state', () => {
    expect(offers.map((o) => o.id)).toEqual(['828100', '80000', '601131600']);
    expect(offers.every((o) => o.chain === 'aldi' && o.source === 'live' && o.observedOn === '2026-11-15')).toBe(true);
    expect(offers.every((o) => o.image?.startsWith('https://s7g10.scene7.com/'))).toBe(true);
  });

  it('takes the published unit price (basePrice) when there is one', () => {
    expect(byId('828100')).toMatchObject({ name: 'Leche evaporada', sizeText: '340 g', priceCents: 92, unitPriceCents: 271, unit: 'kg' });
  });

  it('reads the running promotion and a product without brand', () => {
    expect(byId('601131600')).toMatchObject({
      name: 'Leche semidesnatada',
      brand: null,
      priceCents: 79,
      unitPriceCents: 79,
      unit: 'l',
      promo: euros('Oferta hasta 15/11 (antes 0,82 €)'),
      url: 'https://www.aldi.es/producto/leche-semidesnatada-601131600.html',
    });
  });

  it('drops a promotion that has ended or not started, keeping the strike price', () => {
    const later = parseAldiCategoryPage(CATEGORY, new Date('2026-11-16T08:00:00Z')).find((o) => o.id === '601131600')!;
    expect(later.promo).toBe(euros('Antes 0,82 €'));
    const before = parseAldiCategoryPage(CATEGORY, new Date('2026-11-08T08:00:00Z')).find((o) => o.id === '601131600')!;
    expect(before.promo).toBe(euros('Antes 0,82 €'));
  });

  it('returns [] for a page without products', () => {
    expect(parseAldiCategoryPage('<html></html>', NOW)).toEqual([]);
  });
});

describe('aldiProductToOffer', () => {
  const base = { objectID: '1', name: 'Batido de chocolate', salesUnit: 'pack de 6 x 200 ml', currentPrice: { priceValue: 1.55 } };

  it('computes the unit price from the sales unit when Aldi publishes none', () => {
    expect(aldiProductToOffer(base, NOW)).toMatchObject({ sizeText: '6 × 200 ml', priceCents: 155, unitPriceCents: 129, unit: 'l' });
  });

  it('maps basePrice scales kg and l', () => {
    const withBase = (scale: string, value: number) =>
      aldiProductToOffer({ ...base, currentPrice: { priceValue: 1.55, basePrice: [{ basePriceValue: value, basePriceScale: scale }] } }, NOW);
    expect(withBase('l', 1.29)).toMatchObject({ unitPriceCents: 129, unit: 'l' });
    expect(withBase('kg', 4.04)).toMatchObject({ unitPriceCents: 404, unit: 'kg' });
  });

  it('skips products without id, name or price, unavailable or recalled; never throws', () => {
    expect(aldiProductToOffer({ ...base, objectID: undefined }, NOW)).toBeNull();
    expect(aldiProductToOffer({ ...base, name: '  ' }, NOW)).toBeNull();
    expect(aldiProductToOffer({ ...base, currentPrice: {} }, NOW)).toBeNull();
    expect(aldiProductToOffer({ ...base, isAvailable: false }, NOW)).toBeNull();
    expect(aldiProductToOffer({ ...base, isRecall: true }, NOW)).toBeNull();
    expect(aldiProductToOffer(null, NOW)).toBeNull();
    expect(aldiProductToOffer('x', NOW)).toBeNull();
    expect(aldiProductToOffer({ ...base, assets: 'nope', promotionPrices: 7, currentPrice: { priceValue: 1, basePrice: 'x' } }, NOW)).toMatchObject({
      priceCents: 100, image: null, promo: null,
    });
  });
});

describe('aldi.search', () => {
  it('finds products in the sitemap and reads at most 4 product pages (kind "detail")', async () => {
    const { ctx, calls } = fakeCtx(siteResponder());
    const offers = await aldi.search('leche semidesnatada', ctx);
    expect(calls[0]).toEqual({ url: ALDI_SITEMAP_URL, kind: 'index' });
    const details = calls.slice(1);
    expect(details.length).toBeLessThanOrEqual(ALDI_MAX_DETAILS);
    expect(details).toHaveLength(4);
    expect(details.every((c) => c.kind === 'detail' && /^https:\/\/www\.aldi\.es\/producto\/leche-[a-z-]*semidesnatada[a-z-]*-\d+\.html$/.test(c.url))).toBe(true);
    expect(details.every((c) => aldiAllows(c.url))).toBe(true);
    expect(offers).toHaveLength(4);
    expect(new Set(offers.map((o) => o.id)).size).toBe(4);
    expect(offers.every((o) => o.chain === 'aldi' && o.source === 'live' && o.priceCents === 96)).toBe(true);
  });

  it('reuses the cached sitemap: one sitemap fetch for two searches', async () => {
    const { ctx, calls } = fakeCtx(siteResponder());
    await aldi.search('leche entera', ctx);
    await aldi.search('aceite de oliva virgen extra', ctx);
    expect(calls.filter((c) => c.url === ALDI_SITEMAP_URL)).toHaveLength(1);
    expect(calls.filter((c) => c.kind === 'index')).toHaveLength(1);
  });

  it('flags offers whose page http.ts served from its cache', async () => {
    const { ctx } = fakeCtx(siteResponder((url) => new Response(pageFor(url), {
      headers: url.includes('80500') ? { 'x-cesta-cache': 'hit' } : { 'x-cesta-cache': 'miss' },
    })));
    const offers = await aldi.search('leche semidesnatada', ctx);
    expect(offers.find((o) => o.id === '80500')?.cached).toBe(true);
    expect(offers.filter((o) => o.cached)).toHaveLength(1);
  });

  it('asks for nothing more when no slug matches', async () => {
    const { ctx, calls } = fakeCtx(siteResponder());
    expect(await aldi.search('sobrasada hacendado', ctx)).toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('throws BlockedError on a 403 and stops at once', async () => {
    const { ctx, calls } = fakeCtx(siteResponder(() => new Response('Forbidden', { status: 403 })));
    await expect(aldi.search('leche semidesnatada', ctx)).rejects.toBeInstanceOf(BlockedError);
    expect(calls).toHaveLength(2);
  });

  it('throws BlockedError on 429 for the sitemap and on a challenge page', async () => {
    const r429 = fakeCtx(() => new Response('Too Many Requests', { status: 429 }));
    await expect(aldi.search('leche', r429.ctx)).rejects.toBeInstanceOf(BlockedError);
    clearSitemapCache();
    const challenge = fakeCtx(siteResponder(() => new Response('<html><title>Just a moment...</title><script>var _cf_chl_opt={};</script></html>')));
    await expect(aldi.search('leche', challenge.ctx)).rejects.toBeInstanceOf(BlockedError);
  });

  it('throws a plain Error on other HTTP errors; skips a product that has gone (404) or cannot be read', async () => {
    const r500 = fakeCtx(siteResponder(() => new Response('boom', { status: 500 })));
    const err = await aldi.search('leche semidesnatada', r500.ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(BlockedError);

    let n = 0;
    const mixed = fakeCtx(siteResponder((url) => {
      n += 1;
      if (n === 1) return new Response('gone', { status: 404 });
      if (n === 2) return new Response('<html>no data</html>');
      return new Response(pageFor(url));
    }));
    const offers = await aldi.search('leche semidesnatada', mixed.ctx);
    expect(offers).toHaveLength(2);
    expect(mixed.calls.map((c) => c.kind)).toEqual(['detail', 'detail', 'detail', 'detail']); // sitemap still in memory
  });
});
