import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ahorramas, ahorramasAllows, ahorramasPromo, AHORRAMAS_MAX_DETAILS, AHORRAMAS_SITEMAP_URL, displayBrand, eanFromAssetUrls,
  parseAhorramasCategoryTiles, parseAhorramasProductPage, parseAhorramasUnitPrice, validGtin,
} from '../src/sources/live/ahorramas';
import { clearSitemapCache } from '../src/sources/live/sitemap';
import { BlockedError, type AdapterCtx, type FetchKind } from '../src/sources/live/types';

const fixture = (p: string) => readFileSync(new URL(`./fixtures/ahorramas/${p}`, import.meta.url), 'utf8');
const SITEMAP = fixture('sitemap-product.xml');
const PROMO = fixture('product-37970-promo.html');
const REGULAR = fixture('product-70864.html');
const CATEGORY = fixture('category-leche.html');
const NOW = new Date('2026-11-15T12:00:00Z');
const euros = (s: string) => s.replace(/ €/g, '\u00a0€');
const PROMO_URL = 'https://www.ahorramas.com/sidra-cider-ladron-de-manzanas-25cl-37970.html';
const REGULAR_URL = 'https://www.ahorramas.com/leche-entera-alipende-1l-70864.html';
const ASSETS = 'https://www.ahorramas.com/on/demandware.static/-/Sites-ahorramas-master/default';

/** A product page for another pid, made from the real regular one by swapping the pid. */
const pageFor = (url: string) => {
  const pid = /-(\d+)\.html$/.exec(url)![1]!;
  return REGULAR.replaceAll('"sku":"70864"', `"sku":"${pid}"`).replaceAll('"mpn":"70864"', `"mpn":"${pid}"`);
};

function fakeCtx(respond: (url: string, kind?: FetchKind) => Response, now = NOW) {
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
  url === AHORRAMAS_SITEMAP_URL ? new Response(SITEMAP, { headers: { 'content-type': 'application/xml' } }) : detail(url);

beforeEach(() => clearSitemapCache());

describe('parseAhorramasProductPage', () => {
  it('reads a product on promotion: JSON-LD price, old price, unit price, callout and image', () => {
    expect(parseAhorramasProductPage(PROMO, PROMO_URL, NOW)).toEqual({
      chain: 'ahorramas',
      id: '37970',
      name: 'Sidra cider Ladrón de Manzanas 25cl',
      brand: 'Ladrón de Manzanas',
      ean: null, // the asset folder is the pid (037970), not a GTIN
      sizeText: '250 ml',
      priceCents: 95,
      unitPriceCents: 380,
      unit: 'l',
      image: `${ASSETS}/dw20ccdbee/Assets/037970_C1C1/large/6/9/c/e/69cebc20548813d321709acfa7ec8c4d4142758b_037970_C1C1.jpg`,
      url: PROMO_URL,
      promo: euros('Oferta hasta 25/11 (antes 1,19 €)'),
      source: 'live',
      observedOn: '2026-11-15',
    });
  });

  it('reads a product at its regular price', () => {
    expect(parseAhorramasProductPage(REGULAR, REGULAR_URL, NOW)).toEqual({
      chain: 'ahorramas',
      id: '70864',
      name: 'Leche entera Alipende 1L',
      brand: 'Alipende',
      ean: null,
      sizeText: '1 L',
      priceCents: 96,
      unitPriceCents: 96,
      unit: 'l',
      image: `${ASSETS}/dw3006ac95/Assets/070864_C1C1/large/9/1/a/5/91a52f546b160f71f8a575de1c68dca53a05069c_070864_C1C1.jpg`,
      url: REGULAR_URL,
      promo: null,
      source: 'live',
      observedOn: '2026-11-15',
    });
  });

  it('reads prices only inside the product block, not from the carousels after it', () => {
    const carousel = CATEGORY.slice(CATEGORY.indexOf('<div class="product-container'));
    const page = REGULAR.replace('</body>', `<div class="experience-einstein-carousel">${carousel}</div></body>`);
    expect(parseAhorramasProductPage(page, REGULAR_URL, NOW)).toMatchObject({ priceCents: 96, unitPriceCents: 96, promo: null });
  });

  it('falls back to the computed unit price and to the HTML price when the page lacks them', () => {
    const noUnit = REGULAR.replace(/<span class="unit-price-per-unit grey">[\s\S]*?<\/span>/, '');
    expect(parseAhorramasProductPage(noUnit, REGULAR_URL, NOW)).toMatchObject({ unitPriceCents: 96, unit: 'l' });
    const noLdPrice = REGULAR.replace('"price":"0.96"', '"price":"n/a"');
    expect(parseAhorramasProductPage(noLdPrice, REGULAR_URL, NOW)).toMatchObject({ priceCents: 96 });
  });

  it('returns null, never throws, on pages it cannot read', () => {
    expect(parseAhorramasProductPage('<html><body>Hola</body></html>', REGULAR_URL, NOW)).toBeNull();
    expect(parseAhorramasProductPage('<script type="application/ld+json">{broken</script>', REGULAR_URL, NOW)).toBeNull();
    const noPrice = REGULAR.replace('"price":"0.96"', '"price":"0"').replace(/content="0\.96"/g, '');
    expect(parseAhorramasProductPage(noPrice, REGULAR_URL, NOW)).toBeNull();
  });
});

describe('parseAhorramasCategoryTiles', () => {
  const offers = parseAhorramasCategoryTiles(CATEGORY, NOW);
  const byId = (id: string) => offers.find((o) => o.id === id)!;

  it('reads every tile, sponsored ones included', () => {
    expect(offers.map((o) => o.id)).toEqual(['46423', '62534', '70864']);
    expect(offers.every((o) => o.image?.startsWith('https://www.ahorramas.com/dw/image/v2/') && !o.image.includes('&amp;'))).toBe(true);
  });

  it('reads promo, old price, unit price and the GTIN in the image folder', () => {
    expect(byId('46423')).toMatchObject({
      name: 'Leche Asturiana 1l semidesnatada',
      brand: 'Asturiana',
      ean: '8410297012150',
      sizeText: '1 L',
      priceCents: 109,
      unitPriceCents: 109,
      unit: 'l',
      url: 'https://www.ahorramas.com/leche-asturiana-1l-semidesnatada-46423.html',
      promo: euros('Oferta hasta 16/11 (antes 1,17 €)'),
    });
    expect(byId('70864')).toMatchObject({ brand: 'Alipende', priceCents: 96, promo: null, ean: null });
  });
});

describe('Ahorramas helpers', () => {
  it('maps the published unit price: LITRO -> l, KILO -> kg, UNIDAD -> ud', () => {
    expect(parseAhorramasUnitPrice('3,80€/LITRO')).toEqual({ cents: 380, unit: 'l' });
    expect(parseAhorramasUnitPrice(' 4,04&euro;/KILO ')).toEqual({ cents: 404, unit: 'kg' });
    expect(parseAhorramasUnitPrice('0,25 € / UNIDAD')).toEqual({ cents: 25, unit: 'ud' });
    expect(parseAhorramasUnitPrice('2,40€/DOCENA')).toEqual({ cents: 20, unit: 'ud' });
    expect(parseAhorramasUnitPrice('4,76€')).toBeNull();
    expect(parseAhorramasUnitPrice('1,00€/BARRIL')).toBeNull();
    expect(parseAhorramasUnitPrice(null)).toBeNull();
  });

  it('accepts an image-folder GTIN only with a valid check digit', () => {
    expect(validGtin('08410297012150')).toBe(true);
    expect(validGtin('08410297012151')).toBe(false);
    expect(eanFromAssetUrls(['/x/Assets/08410297012151_C1C1/a.jpg'])).toBeNull();
    expect(eanFromAssetUrls(['/x/Assets/037970_C1C1/a.jpg', '/x/Assets/08410297012150_C1C1/a.jpg'])).toBe('8410297012150');
    expect(eanFromAssetUrls([null, undefined])).toBeNull();
  });

  it('writes the brand as the name does', () => {
    expect(displayBrand('LADRON DE MANZANAS', 'Sidra cider Ladrón de Manzanas 25cl')).toBe('Ladrón de Manzanas');
    expect(displayBrand('LA LECHERA', 'Leche condensada La Lechera bote 740g')).toBe('La Lechera');
    expect(displayBrand('EL VENTERO', 'Queso tierno')).toBe('El Ventero');
    expect(displayBrand('LA', 'Leche lauki')).toBe('La');
    expect(displayBrand('', 'x')).toBeNull();
  });

  it('turns callouts into promo lines', () => {
    expect(ahorramasPromo('Bajada de precio a 0.95€ (Válido del 29/10/26 al 25/11/26)', 95, 119)).toBe(euros('Oferta hasta 25/11 (antes 1,19 €)'));
    expect(ahorramasPromo('2ª unidad al 50% (Válido del 01/11/26 al 30/11/26)', 200, null)).toBe('2ª unidad al 50% hasta 30/11');
    expect(ahorramasPromo(null, 95, 119)).toBe(euros('Antes 1,19 €'));
    expect(ahorramasPromo(null, 95, null)).toBeNull();
  });

  it('never asks for a robots-disallowed URL', () => {
    expect(ahorramasAllows(REGULAR_URL)).toBe(true);
    expect(ahorramasAllows('https://www.ahorramas.com/buscador?q=leche')).toBe(false);
    expect(ahorramasAllows('https://www.ahorramas.com/lacteos/leche/?pmin=0.01&prefn1=brand')).toBe(false);
    expect(ahorramasAllows('https://www.ahorramas.com/lacteos/ver-todo-leche-1.html')).toBe(false);
  });
});

describe('ahorramas.search', () => {
  it('finds products in the sitemap and reads at most 4 product pages (kind "detail")', async () => {
    const { ctx, calls } = fakeCtx(siteResponder());
    const offers = await ahorramas.search('huevos', ctx);
    expect(calls[0]).toEqual({ url: AHORRAMAS_SITEMAP_URL, kind: 'index' });
    const details = calls.slice(1);
    expect(details).toHaveLength(AHORRAMAS_MAX_DETAILS);
    expect(details.every((c) => c.kind === 'detail' && /^https:\/\/www\.ahorramas\.com\/huevos-[^/?]+-\d+\.html$/.test(c.url))).toBe(true);
    expect(details.every((c) => ahorramasAllows(c.url))).toBe(true);
    expect(offers.map((o) => o.id)).toEqual(details.map((c) => /-(\d+)\.html$/.exec(c.url)![1]));
    expect(offers.every((o) => o.chain === 'ahorramas' && o.source === 'live' && o.url?.startsWith('https://www.ahorramas.com/huevos-'))).toBe(true);
  });

  it('reuses the cached sitemap: one sitemap fetch for two searches', async () => {
    const { ctx, calls } = fakeCtx(siteResponder());
    await ahorramas.search('leche semidesnatada', ctx);
    await ahorramas.search('aceite de oliva virgen extra', ctx);
    expect(calls.filter((c) => c.url === AHORRAMAS_SITEMAP_URL)).toHaveLength(1);
    expect(calls.filter((c) => c.kind === 'detail')).toHaveLength(8);
  });

  it('throws BlockedError on a 403 (product page or sitemap) and stops at once', async () => {
    const detail403 = fakeCtx(siteResponder(() => new Response('Forbidden', { status: 403 })));
    await expect(ahorramas.search('leche semidesnatada', detail403.ctx)).rejects.toBeInstanceOf(BlockedError);
    expect(detail403.calls).toHaveLength(2);
    clearSitemapCache();
    const sitemap403 = fakeCtx(() => new Response('Forbidden', { status: 403 }));
    await expect(ahorramas.search('leche', sitemap403.ctx)).rejects.toBeInstanceOf(BlockedError);
    expect(sitemap403.calls).toHaveLength(1);
  });

  it('throws a plain Error on other HTTP errors and skips products gone since the sitemap', async () => {
    const r502 = fakeCtx(siteResponder(() => new Response('bad gateway', { status: 502 })));
    const err = await ahorramas.search('leche semidesnatada', r502.ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(BlockedError);

    const gone = fakeCtx(siteResponder((url) => (url.endsWith('-62534.html') ? new Response('', { status: 404 }) : new Response(pageFor(url)))));
    const offers = await ahorramas.search('leche semidesnatada', gone.ctx);
    expect(gone.calls.some((c) => c.url.endsWith('-62534.html'))).toBe(true);
    expect(offers.map((o) => o.id)).not.toContain('62534');
    expect(offers).toHaveLength(3);
  });
});
