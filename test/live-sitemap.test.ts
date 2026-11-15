import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearSitemapCache, fetchSitemapIndex, foldWord, isChallengePage, matchSlugs, parseSitemap, robotsGuard, safeDecode,
  type SitemapEntry,
} from '../src/sources/live/sitemap';
import { BlockedError, type AdapterCtx, type FetchKind } from '../src/sources/live/types';
import { ALDI_PRODUCT_RE } from '../src/sources/live/aldi';
import { AHORRAMAS_PRODUCT_RE } from '../src/sources/live/ahorramas';

const fixture = (p: string) => readFileSync(new URL(`./fixtures/${p}`, import.meta.url), 'utf8');
const ALDI_XML = fixture('aldi/sitemap-products.xml');
const AHM_XML = fixture('ahorramas/sitemap-product.xml');
const aldiEntries = parseSitemap(ALDI_XML, ALDI_PRODUCT_RE);
const ahmEntries = parseSitemap(AHM_XML, AHORRAMAS_PRODUCT_RE);
const slugs = (list: SitemapEntry[]) => list.map((e) => e.slug);

describe('parseSitemap', () => {
  it('reads every product <loc> as {slug, id, url}', () => {
    expect(aldiEntries).toHaveLength(52);
    expect(ahmEntries).toHaveLength(101);
    expect(aldiEntries).toContainEqual({
      slug: 'leche-semidesnatada', id: '601131600', url: 'https://www.aldi.es/producto/leche-semidesnatada-601131600.html',
    });
    expect(ahmEntries).toContainEqual({
      slug: 'leche-entera-alipende-1l', id: '70864', url: 'https://www.ahorramas.com/leche-entera-alipende-1l-70864.html',
    });
  });

  it('keeps dotted slugs whole and takes the id after the last dash', () => {
    const byId = (id: string) => ahmEntries.find((e) => e.id === id);
    expect(byId('10555')?.slug).toBe('limpiahogar-don-limpio-bano-liquido-detergente-1.5-i');
    expect(byId('2866')?.slug).toBe('tinte-de-cabello-garnier-color-sensation-n-7.0-rubio');
    expect(byId('8785')?.slug).toBe(
      'detergente-en-polvo-para-ropa-flota-frescor-max.-eficacia-blancura-perfume.-bolsa-de-15-lavados',
    );
    expect(byId('11855')?.slug).toBe('balsamo-labial-stick-carmex-4.25g-fresa-f15');
  });

  it('decodes %C2%A0 in the slug but keeps the URL as listed', () => {
    const e = ahmEntries.find((x) => x.id === '44691')!;
    expect(e.slug).toBe('cafe-blonde-espresso-roast-intensidad-6-starbucks-nespresso\u00a0-10-capsulas');
    expect(e.url).toContain('nespresso%C2%A0-10-capsulas-44691.html');
    expect(slugs(matchSlugs(ahmEntries, 'cafe nespresso capsulas', 4))).toEqual([e.slug]);
  });

  it('ignores URLs outside the pattern, decodes entities and never throws on bad escapes', () => {
    const xml = `<urlset>
      <url><loc>https://www.aldi.es/productos/lacteos-y-huevos.html</loc></url>
      <url><loc> https://www.aldi.es/producto/pan-%E0%A4%A-123.html </loc></url>
      <url><loc>https://www.aldi.es/producto/pan-123.html</loc></url>
      <url><loc>https://www.aldi.es/producto/pan-123.html</loc></url>
      <url><loc>https://www.ahorramas.com/a-b-1.html?x=1&amp;y=2</loc><image:loc>https://x/y-2.html</image:loc></url>
    </urlset>`;
    expect(parseSitemap(xml, ALDI_PRODUCT_RE)).toEqual([
      { slug: 'pan-%E0%A4%A', id: '123', url: 'https://www.aldi.es/producto/pan-%E0%A4%A-123.html' },
      { slug: 'pan', id: '123', url: 'https://www.aldi.es/producto/pan-123.html' },
    ]);
    expect(safeDecode('%E0%A4%A')).toBe('%E0%A4%A');
  });
});

describe('matchSlugs', () => {
  it('"leche semidesnatada" finds plain semi-skimmed milk first (Aldi)', () => {
    const top = slugs(matchSlugs(aldiEntries, 'leche semidesnatada', 4));
    expect(top.slice(0, 2)).toEqual(['leche-semidesnatada', 'leche-semidesnatada']);
    expect(top.every((s) => s.startsWith('leche-') && s.includes('semidesnatada'))).toBe(true);
    expect(top).not.toContain('leche-entera');
  });

  it('"leche semidesnatada" on Ahorramas: only semi-skimmed milks, the truncated slug included', () => {
    const all = slugs(matchSlugs(ahmEntries, 'leche semidesnatada', 50));
    expect(all.every((s) => s.startsWith('leche-') && /semidesnata/.test(s))).toBe(true);
    expect(all).toContain('leche-sin-lactosa-asturiana-1l-semidesnata'); // prefix of >= 4 letters
    expect(slugs(matchSlugs(ahmEntries, 'leche semidesnatada', 4))).toEqual([
      'leche-lauki-1l-semidesnatada',
      'leche-pascual-1l-semidesnatada',
      'leche-semidesnatada-alipende-1l',
      'leche-asturiana-1l-semidesnatada',
    ]);
  });

  it('"aceite de oliva virgen extra" returns the oils, not tuna, biscuits or breadsticks', () => {
    const aldiTop = slugs(matchSlugs(aldiEntries, 'aceite de oliva virgen extra', 4));
    expect(aldiTop.length).toBeGreaterThanOrEqual(3);
    expect(aldiTop.every((s) => s.startsWith('aceite-de-oliva-virgen-extra'))).toBe(true);

    const ahmTop = slugs(matchSlugs(ahmEntries, 'aceite de oliva virgen extra', 4));
    expect(ahmTop).toHaveLength(4);
    expect(ahmTop.every((s) => /^aceite-(de-)?oliva-virgen-extra/.test(s))).toBe(true);
  });

  it('"huevos" returns eggs, not chocolate eggs or egg pasta', () => {
    const top = slugs(matchSlugs(ahmEntries, 'huevos', 4));
    expect(top).toHaveLength(4);
    expect(top.every((s) => s.startsWith('huevos-'))).toBe(true);
    expect(top.some((s) => /chocolate|kinder|sorpresa|spaghettini/.test(s))).toBe(false);
  });

  it('folds plural and singular both ways, and accents', () => {
    expect(foldWord('leches')).toBe(foldWord('leche'));
    expect(foldWord('huevos')).toBe(foldWord('huevo'));
    expect(foldWord('nueces')).toBe(foldWord('nuez'));
    expect(foldWord('yogures')).toBe(foldWord('yogur'));
    expect(slugs(matchSlugs(aldiEntries, 'leches semidesnatadas', 2))).toEqual(['leche-semidesnatada', 'leche-semidesnatada']);
    // Same entries either way; only the small as-typed bonus may reorder them.
    const ids = (q: string) => matchSlugs(aldiEntries, q, 10).map((e) => e.id).sort();
    expect(ids('huevo')).toEqual(ids('huevos'));
    expect(ids('huevos')).toHaveLength(4);
    expect(slugs(matchSlugs(aldiEntries, 'Lèche ENTERA', 1))).toEqual(['leche-entera']);
  });

  it('requires every word: a brand the chain does not sell gives nothing', () => {
    expect(matchSlugs(aldiEntries, 'leche semidesnatada hacendado', 4)).toEqual([]);
    expect(matchSlugs(aldiEntries, 'de la y', 4)).toEqual([]);
    expect(matchSlugs(aldiEntries, '', 4)).toEqual([]);
  });

  it('does not treat "leche" as a prefix of "lechuga"', () => {
    expect(slugs(matchSlugs(ahmEntries, 'leche', 200)).some((s) => s.startsWith('lechuga'))).toBe(false);
    expect(slugs(matchSlugs(ahmEntries, 'lechuga', 10)).every((s) => s.includes('lechuga'))).toBe(true);
  });

  it('size tokens break ties between the same product in several sizes', () => {
    expect(slugs(matchSlugs(ahmEntries, 'aceite oliva virgen extra alipende 1l', 1))).toEqual([
      'aceite-oliva-virgen-extra-alipende-1l',
    ]);
    expect(slugs(matchSlugs(ahmEntries, 'aceite oliva virgen extra alipende 750ml', 1))).toEqual([
      'aceite-oliva-virgen-extra-alipende-750ml',
    ]);
    expect(slugs(matchSlugs(ahmEntries, 'aceite oliva virgen extra alipende 5 l', 1))).toEqual([
      'aceite-oliva-virgen-extra-alipende-garrafa-5l',
    ]);
    expect(slugs(matchSlugs(ahmEntries, 'huevos camperos alipende 12 unidades', 1))).toEqual([
      'huevos-camperos-alipende-12-unidades',
    ]);
  });

  it('is deterministic: the order of the sitemap does not change the answer', () => {
    const shuffled = [...ahmEntries].reverse();
    for (const q of ['leche semidesnatada', 'huevos', 'aceite de oliva virgen extra', 'leche']) {
      expect(matchSlugs(shuffled, q, 4)).toEqual(matchSlugs(ahmEntries, q, 4));
    }
    expect(matchSlugs(ahmEntries, 'leche', 4)).toEqual(matchSlugs(ahmEntries, 'leche', 4));
  });
});

describe('fetchSitemapIndex', () => {
  beforeEach(() => clearSitemapCache());

  const ctxWith = (respond: (url: string) => Response, now = new Date('2026-11-15T10:00:00Z')) => {
    const calls: Array<{ url: string; kind?: FetchKind }> = [];
    const ctx: AdapterCtx = {
      now,
      fetch: async (url, init) => {
        calls.push({ url, kind: init?.kind });
        return respond(url);
      },
    };
    return { ctx, calls };
  };
  const URL_ = 'https://www.aldi.es/sitemaps/.aldi-nord-sitemap-products.xml';

  it('fetches once with kind "index" and serves later calls from memory for 24 h', async () => {
    const { ctx, calls } = ctxWith(() => new Response(ALDI_XML));
    const [a, b] = await Promise.all([fetchSitemapIndex(ctx, URL_, ALDI_PRODUCT_RE), fetchSitemapIndex(ctx, URL_, ALDI_PRODUCT_RE)]);
    expect(a).toHaveLength(52);
    expect(b).toBe(a);
    const later = { ...ctx, now: new Date('2026-11-16T09:59:00Z') };
    expect(await fetchSitemapIndex(later, URL_, ALDI_PRODUCT_RE)).toBe(a);
    expect(calls).toEqual([{ url: URL_, kind: 'index' }]);

    const nextDay = { ...ctx, now: new Date('2026-11-16T10:00:01Z') };
    await fetchSitemapIndex(nextDay, URL_, ALDI_PRODUCT_RE);
    expect(calls).toHaveLength(2);
  });

  it('throws BlockedError on 403/429 and on a challenge page, Error otherwise, and caches no failure', async () => {
    await expect(fetchSitemapIndex(ctxWith(() => new Response('no', { status: 403 })).ctx, URL_, ALDI_PRODUCT_RE)).rejects.toBeInstanceOf(BlockedError);
    await expect(fetchSitemapIndex(ctxWith(() => new Response('slow down', { status: 429 })).ctx, URL_, ALDI_PRODUCT_RE)).rejects.toBeInstanceOf(BlockedError);
    const challenge = '<html><head><title>Just a moment...</title></head><body><script>window._cf_chl_opt={}</script></body></html>';
    await expect(fetchSitemapIndex(ctxWith(() => new Response(challenge, { status: 503 })).ctx, URL_, ALDI_PRODUCT_RE)).rejects.toBeInstanceOf(BlockedError);
    await expect(fetchSitemapIndex(ctxWith(() => new Response('<urlset/>', { status: 200, headers: { 'cf-mitigated': 'challenge' } })).ctx, URL_, ALDI_PRODUCT_RE)).rejects.toBeInstanceOf(BlockedError);

    const err = fetchSitemapIndex(ctxWith(() => new Response('oops', { status: 500 })).ctx, URL_, ALDI_PRODUCT_RE);
    await expect(err).rejects.toThrow(/HTTP 500/);
    await expect(err).rejects.not.toBeInstanceOf(BlockedError);
    await expect(fetchSitemapIndex(ctxWith(() => new Response('<urlset></urlset>')).ctx, URL_, ALDI_PRODUCT_RE)).rejects.toThrow(/without product URLs/);

    const { ctx, calls } = ctxWith(() => new Response(ALDI_XML));
    expect(await fetchSitemapIndex(ctx, URL_, ALDI_PRODUCT_RE)).toHaveLength(52);
    expect(calls).toHaveLength(1);
  });

  it('recognises challenge pages but not ordinary pages', () => {
    expect(isChallengePage('<title>Attention Required! | Cloudflare</title>')).toBe(true);
    expect(isChallengePage('<script src="/_Incapsula_Resource?x=1"></script>')).toBe(true);
    expect(isChallengePage(fixture('ahorramas/product-70864.html'))).toBe(false);
    expect(isChallengePage(fixture('aldi/product-leche-entera-80000.html'))).toBe(false);
  });
});

describe('robotsGuard', () => {
  it('applies Disallow prefixes, * and $', () => {
    const allows = robotsGuard(['/can/', '/can$', '/*?*filters', '*ver-todo*', '/buscador?*']);
    expect(allows('https://www.aldi.es/producto/leche-entera-80000.html')).toBe(true);
    expect(allows('https://www.aldi.es/can/producto/x-1.html')).toBe(false);
    expect(allows('https://www.aldi.es/can')).toBe(false);
    expect(allows('https://www.aldi.es/cantimplora-1.html')).toBe(true);
    expect(allows('https://www.aldi.es/productos.html?filters=a')).toBe(false);
    expect(allows('https://www.ahorramas.com/lacteos/ver-todo/')).toBe(false);
    expect(allows('https://www.ahorramas.com/buscador?q=leche')).toBe(false);
    expect(allows('not a url')).toBe(false);
  });
});
