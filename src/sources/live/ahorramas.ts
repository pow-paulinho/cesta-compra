/**
 * Ahorramas (www.ahorramas.com, Salesforce Commerce Cloud): live prices from robots-allowed
 * product pages, found through the product sitemap. Its search page is disallowed.
 *
 * robots.txt (https://www.ahorramas.com/robots.txt, read 2026-11-15): the lines this
 * module relies on, all of them, are quoted verbatim in the line comment below this block
 * (one of them contains the characters that would close it).
 *
 * We fetch the product sitemap listed in that index (/sitemap_0-product.xml, ~1.1 MB,
 * kind 'index', 24 h) and product pages /<slug>-<pid>.html (kind 'detail'), never the
 * search page, never with a query string (no prefn/pmin/pmax/srule), and every URL is
 * checked against the Disallow lines above.
 *
 * What a product page (~477 KB) carries: JSON-LD @type Product (name, sku = pid,
 * brand.name, offers.price = today's price, offers.availability, image[] site-relative
 * originals first) and, inside div.container.product-detail: span.unit-price-per-unit.grey
 * "3,80€/LITRO" | "4,04€/KILO", del span.strike-through.list span.value[content] (the old
 * price), div.promotions .callout "Bajada de precio a 0.95€ (Válido del 29/10/26 al
 * 25/11/26)", img.zoom-img[data-original] (site-relative original image). Recommendation
 * carousels with other products follow that block, so price markup is read only inside it.
 * No EAN; an image folder Assets/<14 digits>_C1C1 is a GTIN-14 when its check digit is
 * valid, and only then is it used.
 *
 * Politeness: at most AHORRAMAS_MAX_DETAILS (4) product pages per search(), one after the
 * other through ctx.fetch (spaced, cached 12 h by http.ts), plus the cached sitemap.
 */
// robots.txt, verbatim:
//
//   User-agent: *
//   Disallow: *&prefn1*
//   Disallow: *?pmax*
//   Disallow: */login*
//   Disallow: /cart*
//   Disallow: /buscador?*
//   Disallow: /on/demandware.store/Sites-Ahorramas-Site/es/Search-ShowAjax*
//   Disallow: /on/demandware.store/Sites-Ahorramas-Site/es/Product-Variation*
//   Disallow: *ver-todo*
//   Disallow: *informacion-ahorramas.html*
//
//   Sitemap: https://www.ahorramas.com/sitemap_index.xml

import type { Offer, PriceUnit } from '../../shared/types';
import { formatEuros, formatSize, sizeFromName, unitPriceCents } from '../../shared/units';
import {
  absoluteUrl, cleanBrand, dayMonth, decodeHtml, eurosToCents, fetchPageWithMeta, fetchSitemapIndex, htmlText, isoDay,
  matchSlugs, priceUnitFromLabel, robotsGuard,
} from './sitemap';
import type { AdapterCtx, ChainAdapter } from './types';

export const AHORRAMAS_BASE = 'https://www.ahorramas.com';
export const AHORRAMAS_SITEMAP_URL = `${AHORRAMAS_BASE}/sitemap_0-product.xml`;
export const AHORRAMAS_PRODUCT_RE = /^https:\/\/www\.ahorramas\.com\/(?<slug>[^/?#]+)-(?<id>\d+)\.html$/;
export const AHORRAMAS_MAX_DETAILS = 4;

export const AHORRAMAS_DISALLOW = [
  '*&prefn1*', '*?pmax*', '*/login*', '/cart*', '/buscador?*',
  '/on/demandware.store/Sites-Ahorramas-Site/es/Search-ShowAjax*',
  '/on/demandware.store/Sites-Ahorramas-Site/es/Product-Variation*',
  '*ver-todo*', '*informacion-ahorramas.html*',
] as const;
export const ahorramasAllows = robotsGuard(AHORRAMAS_DISALLOW);

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------
// Small readers
// ---------------------------------------------------------------------------

/** An attribute of one HTML start tag, entities decoded; null when absent. */
function attr(tag: string, name: string): string | null {
  const m = new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag);
  return m ? decodeHtml(m[1]!) : null;
}

/** Start tags of `tagName` whose class list contains `cls`. */
function tagsWithClass(html: string, tagName: string, cls: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))) {
    const c = attr(m[0], 'class');
    if (c && c.split(/\s+/).includes(cls)) out.push(m[0]);
  }
  return out;
}

/**
 * The HTML after the first start tag whose class list holds every class in `classes`, up to
 * the next closing tag of the same name (enough for the leaf elements read here).
 */
function innerOf(html: string, tagName: string, classes: string[]): string | null {
  for (const m of html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))) {
    const list = (attr(m[0], 'class') ?? '').split(/\s+/);
    if (!classes.every((c) => list.includes(c))) continue;
    const from = m.index! + m[0].length;
    const close = html.toLowerCase().indexOf(`</${tagName}`, from);
    return html.slice(from, close >= 0 ? close : from + 2000);
  }
  return null;
}

/** The `content` price right after the element with these classes (e.g. strike-through list). */
function contentPriceAfter(html: string, classes: string[]): number | null {
  for (const m of html.matchAll(/<span\b[^>]*\sclass\s*=\s*"([^"]*)"[^>]*>/gi)) {
    const list = m[1]!.split(/\s+/);
    if (!classes.every((c) => list.includes(c))) continue;
    const near = html.slice(m.index!, m.index! + 600);
    const content = /\scontent\s*=\s*"([^"]+)"/.exec(near.slice(m[0].length));
    if (content) return eurosToCents(content[1]);
  }
  return null;
}

/** "3,80€/LITRO" -> {380, 'l'}; "4,04 €/KILO" -> {404, 'kg'}; "0,25€/UNIDAD" -> {25, 'ud'}. */
export function parseAhorramasUnitPrice(text: string | null | undefined): { cents: number; unit: PriceUnit } | null {
  if (typeof text !== 'string') return null;
  const m = /(\d+(?:[.,]\d+)*)\s*€\s*\/\s*([A-Za-zÁÉÍÓÚáéíóú0-9 ]+?)\s*$/.exec(decodeHtml(text).replace(/\s+/g, ' ').trim());
  if (!m) return null;
  const cents = eurosToCents(m[1]);
  const unit = priceUnitFromLabel(m[2]!);
  if (cents === null || !unit) return null;
  return { cents: Math.round(cents / unit.per), unit: unit.unit };
}

/** True when the last digit of an EAN-8/UPC-12/EAN-13/GTIN-14 is right. */
export function validGtin(code: string): boolean {
  if (!/^(\d{8}|\d{12,14})$/.test(code)) return false;
  const digits = [...code].map(Number);
  const check = digits.pop()!;
  let sum = 0;
  for (let i = digits.length - 1, w = 3; i >= 0; i--, w = w === 3 ? 1 : 3) sum += digits[i]! * w;
  return (10 - (sum % 10)) % 10 === check;
}

/** The EAN-13 hidden in an asset folder "Assets/08410297012150_C1C1", only with a valid check digit. */
export function eanFromAssetUrls(urls: Array<string | null | undefined>): string | null {
  for (const u of urls) {
    if (typeof u !== 'string') continue;
    for (const m of u.matchAll(/Assets\/(\d{14})_C1C1/g)) {
      const gtin = m[1]!;
      if (gtin.startsWith('0') && validGtin(gtin)) return gtin.slice(1);
    }
  }
  return null;
}

/** One character folded for comparisons, keeping the string length (so indexes still match). */
const foldChar = (c: string): string => (c.normalize('NFD')[0] ?? c).toLowerCase()[0] ?? c;
const foldKeepLength = (s: string): string => Array.from({ length: s.length }, (_, i) => foldChar(s[i]!)).join('');

/** The brand as the product name writes it ("LADRON DE MANZANAS" -> "Ladrón de Manzanas"), else cleaned. */
export function displayBrand(raw: unknown, name: string): string | null {
  const b = typeof raw === 'string' ? decodeHtml(raw).replace(/\s+/g, ' ').trim() : '';
  if (!b) return null;
  const hay = foldKeepLength(name);
  const needle = foldKeepLength(b);
  for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) {
    const before = i === 0 ? ' ' : hay[i - 1]!;
    const after = hay[i + needle.length] ?? ' ';
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return name.slice(i, i + b.length);
  }
  return cleanBrand(b);
}

/**
 * The promo line from a callout: a price drop -> "Oferta hasta 25/11 (antes 1,19 €)", any
 * other callout -> its words plus "hasta DD/MM"; a strike price alone -> "Antes 1,19 €".
 */
export function ahorramasPromo(callout: string | null, priceCents: number, oldCents: number | null): string | null {
  const old = oldCents !== null && oldCents > priceCents ? oldCents : null;
  const text = callout ? callout.replace(/\s+/g, ' ').trim() : '';
  if (!text) return old !== null ? `Antes ${formatEuros(old)}` : null;
  let end: string | null = null;
  for (const paren of text.matchAll(/\(([^)]*)\)/g)) {
    const dates = [...paren[1]!.matchAll(/(\d{1,2})\/(\d{1,2})\/\d{2,4}/g)];
    const last = dates.at(-1);
    if (last) end = dayMonth(Number(last[1]), Number(last[2]));
  }
  const before = old !== null ? ` (antes ${formatEuros(old)})` : '';
  if (/bajada de precio|precio rebajado|^oferta/i.test(text)) return `${end ? `Oferta hasta ${end}` : 'Oferta'}${before}`;
  const label = text.replace(/\s*\(.*$/, '').trim().slice(0, 60);
  if (!label) return end ? `Oferta hasta ${end}${before}` : old !== null ? `Antes ${formatEuros(old)}` : null;
  return `${label}${end ? ` hasta ${end}` : ''}`;
}

interface Fields {
  id: string;
  name: string;
  brand: unknown;
  priceCents: number;
  oldCents: number | null;
  unitText: string | null;
  callout: string | null;
  image: string | null;
  imageUrls: Array<string | null | undefined>;
  url: string | null;
}

function toOffer(f: Fields, now: Date): Offer {
  const size = sizeFromName(f.name);
  const unitPrice = parseAhorramasUnitPrice(f.unitText) ?? unitPriceCents(f.priceCents, size);
  return {
    chain: 'ahorramas',
    id: f.id,
    name: f.name,
    brand: displayBrand(f.brand, f.name),
    ean: eanFromAssetUrls(f.imageUrls),
    sizeText: size ? formatSize(size) : null,
    priceCents: f.priceCents,
    unitPriceCents: unitPrice?.cents ?? null,
    unit: unitPrice?.unit ?? null,
    image: f.image,
    url: f.url,
    promo: ahorramasPromo(f.callout, f.priceCents, f.oldCents),
    source: 'live',
    observedOn: isoDay(now),
  };
}

// ---------------------------------------------------------------------------
// Product page
// ---------------------------------------------------------------------------

function jsonLdProducts(html: string): Json[] {
  const out: Json[] = [];
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (isObj(v)) {
      const t = v['@type'];
      if (t === 'Product' || (Array.isArray(t) && t.includes('Product'))) out.push(v);
      if (Array.isArray(v['@graph'])) visit(v['@graph']);
    }
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*"application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(m[1]!));
    } catch {
      // a broken block is skipped
    }
  }
  return out;
}

/** The div.container.product-detail block, up to the recommendation carousels that follow it. */
function detailBlock(html: string): string {
  const start = html.search(/<div\b[^>]*\sclass\s*=\s*"[^"]*\bproduct-detail(?![\w-])[^"]*"/);
  if (start < 0) return '';
  const rest = html.slice(start);
  const end = rest.slice(1).search(/experience-einstein|einstein-carousel|<footer\b|class="product-tile\b/);
  return rest.slice(0, end >= 0 ? end + 1 : 80_000).replace(/<!--[\s\S]*?-->/g, '');
}

const str = (v: unknown): string | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  if (typeof v !== 'string') return null;
  const s = decodeHtml(v).replace(/\s+/g, ' ').trim();
  return s || null;
};

/** The product of an Ahorramas product page; null when it cannot be read or has no price. */
export function parseAhorramasProductPage(html: string, url: string, now: Date): Offer | null {
  const urlId = AHORRAMAS_PRODUCT_RE.exec(url)?.groups?.id ?? null;
  const products = jsonLdProducts(html);
  const ld = products.find((p) => urlId !== null && str(p.sku) === urlId) ?? products[0] ?? {};
  const block = detailBlock(html);

  const name = str(ld.name) ?? (block ? str(htmlText(innerOf(block, 'p', ['product-name']) ?? '')) : null);
  const id = str(ld.sku) ?? str(ld.mpn) ?? (block ? attr(/<div\b[^>]*>/.exec(block)?.[0] ?? '', 'data-pid') : null) ?? urlId;
  if (!name || !id) return null;

  const offers = Array.isArray(ld.offers) ? ld.offers.find(isObj) : isObj(ld.offers) ? ld.offers : null;
  if (offers && typeof offers.availability === 'string' && /Discontinued/i.test(offers.availability)) return null;
  const priceCents =
    (offers ? eurosToCents(offers.price) ?? eurosToCents(offers.lowPrice) : null) ??
    (block ? contentPriceAfter(block, ['sales']) : null);
  if (priceCents === null) return null;

  const ldImages = (Array.isArray(ld.image) ? ld.image : [ld.image]).filter((i): i is string => typeof i === 'string');
  const zoom = block ? tagsWithClass(block, 'img', 'zoom-img').map((t) => attr(t, 'data-original') ?? attr(t, 'src')) : [];
  const ogImage = /<meta\b[^>]*property\s*=\s*"og:image"[^>]*>/i.exec(html);
  const image =
    absoluteUrl(zoom.find((z) => z) ?? null, AHORRAMAS_BASE) ??
    absoluteUrl(ldImages[0] ?? null, AHORRAMAS_BASE) ??
    absoluteUrl(ogImage ? attr(ogImage[0], 'content') : null, AHORRAMAS_BASE);

  const callout = block ? innerOf(block, 'div', ['callout']) : null;

  return toOffer(
    {
      id,
      name,
      brand: isObj(ld.brand) ? ld.brand.name : ld.brand,
      priceCents,
      oldCents: block ? contentPriceAfter(block, ['strike-through', 'list']) : null,
      unitText: block ? htmlText(innerOf(block, 'span', ['unit-price-per-unit', 'grey']) ?? '') || null : null,
      callout: callout ? htmlText(callout) : null,
      image,
      imageUrls: [...ldImages, ...zoom],
      url: AHORRAMAS_PRODUCT_RE.test(url) ? url : absoluteUrl(url, AHORRAMAS_BASE),
    },
    now,
  );
}

// ---------------------------------------------------------------------------
// Category tiles (/lacteos/leche/ and the like)
// ---------------------------------------------------------------------------

/** Every product tile of an Ahorramas category page, de-duplicated by pid. */
export function parseAhorramasCategoryTiles(html: string, now: Date): Offer[] {
  const clean = html.replace(/<!--[\s\S]*?-->/g, '');
  const starts = [...clean.matchAll(/<div\b[^>]*\sclass\s*=\s*"product"[^>]*>/gi)]
    .map((m) => ({ at: m.index!, pid: attr(m[0], 'data-pid') }))
    .filter((s): s is { at: number; pid: string } => !!s.pid);
  const out: Offer[] = [];
  const seen = new Set<string>();
  starts.forEach((s, i) => {
    if (seen.has(s.pid)) return;
    const tile = clean.slice(s.at, starts[i + 1]?.at ?? clean.length);
    const img = tagsWithClass(tile, 'img', 'tile-image')[0] ?? null;
    const name = str(htmlText(innerOf(tile, 'h2', ['product-name-gtm']) ?? '')) ?? (img ? str(attr(img, 'alt')) : null);
    const priceCents = contentPriceAfter(tile, ['sales']);
    if (!name || priceCents === null) return;
    const brandTag = /<div\b[^>]*\sclass\s*=\s*"product-tile\b[^>]*>/i.exec(tile)?.[0] ?? '';
    const link = tagsWithClass(tile, 'a', 'product-pdp-link')[0] ?? null;
    const src = img ? attr(img, 'src') : null;
    const label = innerOf(tile, 'div', ['promo-info-label']);
    seen.add(s.pid);
    out.push(
      toOffer(
        {
          id: s.pid,
          name,
          brand: attr(brandTag, 'data-brand'),
          priceCents,
          oldCents: contentPriceAfter(tile, ['strike-through', 'list']),
          unitText: htmlText(innerOf(tile, 'span', ['unit-price-per-unit', 'grey']) ?? '') || null,
          callout: label ? htmlText(label) : null,
          image: absoluteUrl(src, AHORRAMAS_BASE),
          imageUrls: [src],
          url: absoluteUrl(link ? attr(link, 'href') : null, AHORRAMAS_BASE),
        },
        now,
      ),
    );
  });
  return out;
}

// ---------------------------------------------------------------------------
// The adapter
// ---------------------------------------------------------------------------

export const ahorramas: ChainAdapter = {
  chain: 'ahorramas',
  async search(query: string, ctx: AdapterCtx): Promise<Offer[]> {
    const entries = await fetchSitemapIndex(ctx, AHORRAMAS_SITEMAP_URL, AHORRAMAS_PRODUCT_RE);
    const picks = matchSlugs(entries, query, AHORRAMAS_MAX_DETAILS * 3)
      .filter((e) => ahorramasAllows(e.url))
      .slice(0, AHORRAMAS_MAX_DETAILS);
    const offers: Offer[] = [];
    for (const pick of picks) {
      const page = await fetchPageWithMeta(ctx, pick.url, 'detail');
      if (page === null) continue; // gone since the sitemap was written
      const offer = parseAhorramasProductPage(page.text, pick.url, ctx.now);
      if (!offer) continue; // one unreadable page never sinks the search
      if (page.cached) offer.cached = true;
      if (!offers.some((o) => o.id === offer.id)) offers.push(offer);
    }
    return offers;
  },
};
