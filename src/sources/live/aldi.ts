/**
 * Aldi (www.aldi.es): live prices from robots-allowed product pages, found through the
 * product sitemap. Aldi Spain has no server-side text search (its /buscar, /busqueda and
 * /search answer 308 to the home page; /busqueda.html renders results in the browser).
 *
 * robots.txt (https://www.aldi.es/robots.txt, read 2026-11-15) — the lines this module
 * relies on, all of them:
 *
 *   User-agent: *
 *   Sitemap: https://www.aldi.es/.aldi-nord-sitemap.xml
 *   Disallow: /reg-cat.html
 *   Disallow: /reg-bal.html
 *   Disallow: /reg-can.html
 *   Disallow: /ua-bot.html
 *   Disallow: /can/            (also /can.html, /can$)
 *   Disallow: /bal/            (also /bal.html, /bal$)
 *   Disallow: /mds/
 *   Disallow: /*?*filters
 *   Disallow: /*?*jobId=
 *
 * We fetch only the products sitemap listed in that sitemap index
 * (/sitemaps/.aldi-nord-sitemap-products.xml, kind 'index', 24 h) and product pages
 * /producto/<slug>-<id>.html (kind 'detail'), never with a query string, never a
 * regional page. Every URL is also checked against the Disallow lines above.
 *
 * What a product page carries: a Next.js `<script id="__NEXT_DATA__">` whose
 * `props.pageProps.apiData` is a JSON *string* holding `[key, {req, res}]` pairs; the
 * "PRODUCT_DETAIL_GET" pair has `res.products[0]` with objectID, name, brandName (not
 * always), salesUnit ("1 l unidad", "pack de 6 x 200 ml"), currentPrice.priceValue (EUR),
 * currentPrice.basePrice[0] {basePriceValue, basePriceScale "kg"|"l"} (often missing),
 * currentPrice.strikePrice, promotionPrices[] with local dates, assets[] (absolute Scene7
 * URLs), productSlug. No EAN. Prices are the Peninsula's (Algolia index "…_pen_…"); the
 * Balearic and Canary Islands may differ. Category pages (/productos/<cat>/<sub>.html)
 * carry the same objects under `algoliaState.initialResults.<index>.results[0].hits`.
 *
 * Politeness: at most ALDI_MAX_DETAILS (4) product pages per search(), fetched one after
 * the other through ctx.fetch (spaced, cached 12 h by http.ts), plus the cached sitemap.
 */
import type { Offer, PriceUnit } from '../../shared/types';
import { formatEuros, formatSize, parseSize, sizeFromName, unitPriceCents } from '../../shared/units';
import {
  absoluteUrl, cleanBrand, dayMonth, eurosToCents, fetchPageWithMeta, fetchSitemapIndex, isoDay, matchSlugs,
  priceUnitFromLabel, robotsGuard,
} from './sitemap';
import type { AdapterCtx, ChainAdapter } from './types';

export const ALDI_BASE = 'https://www.aldi.es';
export const ALDI_SITEMAP_URL = `${ALDI_BASE}/sitemaps/.aldi-nord-sitemap-products.xml`;
export const ALDI_PRODUCT_RE = /^https:\/\/www\.aldi\.es\/producto\/(?<slug>[^/?#]+)-(?<id>\d+)\.html$/;
export const ALDI_MAX_DETAILS = 4;

export const ALDI_DISALLOW = [
  '/reg-cat.html', '/reg-bal.html', '/reg-can.html', '/ua-bot.html',
  '/can/', '/can.html', '/can$', '/bal/', '/bal.html', '/bal$', '/mds/',
  '/*?*filters', '/*?*jobId=',
] as const;
export const aldiAllows = robotsGuard(ALDI_DISALLOW);

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s || null;
};

// ---------------------------------------------------------------------------
// Reading the page
// ---------------------------------------------------------------------------

/** props.pageProps of the page's __NEXT_DATA__, or null. */
function nextPageProps(html: string): Json | null {
  const m = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/.exec(html);
  if (!m) return null;
  try {
    const data: unknown = JSON.parse(m[1]!);
    const pp = isObj(data) && isObj(data.props) ? data.props.pageProps : null;
    return isObj(pp) ? pp : null;
  } catch {
    return null;
  }
}

/** The `res` of an apiData entry, whether apiData is a JSON string of pairs, the pairs, or a map. */
function apiResponse(pageProps: Json, key: string): unknown {
  let api: unknown = pageProps.apiData;
  if (typeof api === 'string') {
    try {
      api = JSON.parse(api);
    } catch {
      return null;
    }
  }
  if (Array.isArray(api)) {
    for (const pair of api) {
      if (Array.isArray(pair) && pair[0] === key && isObj(pair[1])) return pair[1].res;
    }
    return null;
  }
  if (isObj(api) && isObj(api[key])) return (api[key] as Json).res;
  return null;
}

/** The current promotion's "Oferta hasta 15/11 (antes 0,82 €)", or "Antes 0,82 €" with a strike price only. */
function promoOf(p: Json, now: Date, priceCents: number): string | null {
  const today = isoDay(now);
  const nowSec = now.getTime() / 1000;
  const cp = isObj(p.currentPrice) ? p.currentPrice : {};
  const strike = (o: unknown): number | null =>
    isObj(o) && isObj(o.strikePrice) ? eurosToCents(o.strikePrice.strikePriceValue) : null;
  const before = (cents: number | null) => (cents !== null && cents > priceCents ? ` (antes ${formatEuros(cents)})` : '');

  const promos = Array.isArray(p.promotionPrices) ? p.promotionPrices.filter(isObj) : [];
  for (const pr of promos) {
    const from = typeof pr.validFromLocalDate === 'string' ? pr.validFromLocalDate : null;
    const until = typeof pr.validUntilLocalDate === 'string' ? pr.validUntilLocalDate : null;
    const fromSec = typeof pr.validFrom === 'number' ? pr.validFrom : null;
    const untilSec = typeof pr.validUntil === 'number' ? pr.validUntil : null;
    const started = from ? from <= today : fromSec === null || fromSec <= nowSec;
    const running = until ? until >= today : untilSec === null || untilSec >= nowSec;
    if (!started || !running) continue;
    const old = strike(pr) ?? strike(cp);
    let end: string | null = null;
    const ymd = until ? /^(\d{4})-(\d{2})-(\d{2})/.exec(until) : null;
    if (ymd) end = dayMonth(Number(ymd[3]), Number(ymd[2]));
    else if (untilSec !== null) {
      const d = new Date(untilSec * 1000);
      end = dayMonth(d.getUTCDate(), d.getUTCMonth() + 1);
    }
    return `${end ? `Oferta hasta ${end}` : 'Oferta'}${before(old)}`;
  }
  const old = strike(cp);
  return old !== null && old > priceCents ? `Antes ${formatEuros(old)}` : null;
}

/** Unit price from basePrice[0] when Aldi publishes it ("kg" | "l"), else computed from the size. */
function unitPriceOf(p: Json, priceCents: number, size: ReturnType<typeof parseSize>): { cents: number; unit: PriceUnit } | null {
  const cp = isObj(p.currentPrice) ? p.currentPrice : {};
  const base = Array.isArray(cp.basePrice) ? cp.basePrice.find(isObj) : null;
  if (base) {
    const cents = eurosToCents(base.basePriceValue);
    const scale = typeof base.basePriceScale === 'string' ? priceUnitFromLabel(base.basePriceScale) : null;
    if (cents !== null && scale) return { cents: Math.round(cents / scale.per), unit: scale.unit };
  }
  return unitPriceCents(priceCents, size);
}

/**
 * One Aldi product object (a PRODUCT_DETAIL_GET product or a category hit) as an Offer;
 * null when it lacks an id, a name or a price, or is not on sale (unavailable, recalled).
 */
export function aldiProductToOffer(p: unknown, now: Date): Offer | null {
  if (!isObj(p)) return null;
  const id = typeof p.objectID === 'string' || typeof p.objectID === 'number' ? String(p.objectID).trim() : '';
  const name = text(p.name);
  if (!id || !name) return null;
  if (p.isAvailable === false || p.isRecall === true) return null;

  const cp = isObj(p.currentPrice) ? p.currentPrice : null;
  let priceCents = cp ? eurosToCents(cp.priceValue) : null;
  if (priceCents === null && Array.isArray(p.promotionPrices)) {
    const first = p.promotionPrices.find(isObj);
    if (first) priceCents = eurosToCents(first.priceValue);
  }
  if (priceCents === null) return null;

  const salesUnit = text(p.salesUnit);
  const size = parseSize(salesUnit) ?? sizeFromName(name);
  const unitPrice = unitPriceOf(p, priceCents, size);

  const assets = Array.isArray(p.assets) ? p.assets.filter(isObj) : [];
  const asset = assets.find((a) => a.type === 'primary') ?? assets[0];
  const slug = text(p.productSlug);

  return {
    chain: 'aldi',
    id,
    name,
    brand: cleanBrand(p.brandName),
    ean: null,
    sizeText: size ? formatSize(size) : salesUnit ? salesUnit.replace(/\s+unidad(es)?$/i, '') : null,
    priceCents,
    unitPriceCents: unitPrice?.cents ?? null,
    unit: unitPrice?.unit ?? null,
    image: absoluteUrl(asset && typeof asset.url === 'string' ? asset.url : null, ALDI_BASE),
    url: slug && /^[a-z0-9-]+$/i.test(slug) ? `${ALDI_BASE}/producto/${slug}.html` : null,
    promo: promoOf(p, now, priceCents),
    source: 'live',
    observedOn: isoDay(now),
  };
}

/** The product of an Aldi product page (/producto/<slug>-<id>.html); null when it cannot be read. */
export function parseAldiProductPage(html: string, now: Date): Offer | null {
  const pp = nextPageProps(html);
  if (!pp) return null;
  const res = apiResponse(pp, 'PRODUCT_DETAIL_GET');
  const products = isObj(res) && Array.isArray(res.products) ? res.products : [];
  return aldiProductToOffer(products[0], now);
}

/** Every product of an Aldi category page (/productos/<cat>/<sub>.html), de-duplicated by id. */
export function parseAldiCategoryPage(html: string, now: Date): Offer[] {
  const pp = nextPageProps(html);
  const state = pp && isObj(pp.algoliaState) ? pp.algoliaState : null;
  const initial = state && isObj(state.initialResults) ? state.initialResults : null;
  if (!initial) return [];
  const out: Offer[] = [];
  const seen = new Set<string>();
  for (const index of Object.values(initial)) {
    const results = isObj(index) && Array.isArray(index.results) ? index.results : [];
    for (const r of results) {
      const hits = isObj(r) && Array.isArray(r.hits) ? r.hits : [];
      for (const hit of hits) {
        const offer = aldiProductToOffer(hit, now);
        if (offer && !seen.has(offer.id)) {
          seen.add(offer.id);
          out.push(offer);
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export const aldi: ChainAdapter = {
  chain: 'aldi',
  async search(query: string, ctx: AdapterCtx): Promise<Offer[]> {
    const entries = await fetchSitemapIndex(ctx, ALDI_SITEMAP_URL, ALDI_PRODUCT_RE);
    const picks = matchSlugs(entries, query, ALDI_MAX_DETAILS * 3)
      .filter((e) => aldiAllows(e.url))
      .slice(0, ALDI_MAX_DETAILS);
    const offers: Offer[] = [];
    for (const pick of picks) {
      const page = await fetchPageWithMeta(ctx, pick.url, 'detail');
      if (page === null) continue; // gone since the sitemap was written
      const offer = parseAldiProductPage(page.text, ctx.now);
      if (!offer) continue; // one unreadable page never sinks the search
      if (!offer.url) offer.url = pick.url;
      if (page.cached) offer.cached = true;
      if (!offers.some((o) => o.id === offer.id)) offers.push(offer);
    }
    return offers;
  },
};
