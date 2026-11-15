/**
 * Open Food Facts (world.openfoodfacts.org): product cards and details — photos, Nutri-Score,
 * NOVA, ingredients, allergens. It has no prices: cards come back with `offers: []`.
 *
 * robots.txt (https://world.openfoodfacts.org/robots.txt, read 2026-11-15):
 *
 *   User-agent: *
 *   Disallow: /api
 *   Disallow: /cgi
 *   Disallow: /facets
 *
 * Those lines keep crawlers out of /api and /cgi. This module does not crawl: it makes the
 * read requests OFF's API documentation invites apps to make ("Introduction to Open Food Facts
 * API documentation", read 2026-11-15), within the limits it states:
 *
 *   "We ask you to always use a custom User-Agent to identify your app"  (http.ts sends one)
 *   "15 req/min/IP address for all read product queries" (GET /api/v2/product/…)
 *   "10 req/min/IP address for all search queries" (GET /cgi/search.pl among them);
 *   "don't use it for a search-as-you-type feature"
 *
 * So: one request per user search (submitted, never as-you-type), page 1 only (page 2 answered
 * 503 in the probe), one request per details lookup; kinds 'search' and 'detail' so http.ts
 * caches them 6 h and 12 h; and a per-isolate window that refuses to send more than 10 searches
 * or 15 product reads a minute. Full-text search only exists in the legacy /cgi/search.pl.
 *
 * Licences: data ODbL (attribute "Open Food Facts"), images CC BY-SA.
 */
import type { Product, ProductDetails } from '../../shared/types';
import { BlockedError, type AdapterCtx } from './types';

export const OFF_BASE = 'https://world.openfoodfacts.org';
export const OFF_PAGE_SIZE = 12;

const SEARCH_FIELDS = 'code,product_name,product_name_es,brands,quantity,image_front_small_url,image_front_url,nutriscore_grade,nova_group';
const DETAIL_FIELDS = 'code,product_name,product_name_es,generic_name_es,brands,quantity,image_front_url,image_front_small_url,image_url,nutriscore_grade,nova_group,ingredients_text_es,allergens_tags,categories_tags,labels_tags';

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim();
  return s || null;
};

const normaliseQuery = (q: string): string => q.replace(/\s+/g, ' ').trim().toLowerCase();

export function offSearchUrl(query: string): string {
  const q = encodeURIComponent(normaliseQuery(query));
  return `${OFF_BASE}/cgi/search.pl?search_terms=${q}&search_simple=1&action=process&json=1`
    + `&page_size=${OFF_PAGE_SIZE}&tagtype_0=countries&tag_contains_0=contains&tag_0=spain&fields=${SEARCH_FIELDS}`;
}

export function offDetailsUrl(ean: string): string {
  return `${OFF_BASE}/api/v2/product/${encodeURIComponent(ean)}.json?fields=${DETAIL_FIELDS}`;
}

/** Digits of a barcode when it is one (8–14 digits); null otherwise. */
export function barcode(v: unknown): string | null {
  const d = (typeof v === 'number' ? String(v) : typeof v === 'string' ? v : '').replace(/\D/g, '');
  return /^\d{8,14}$/.test(d) ? d : null;
}

function httpsUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  try {
    const u = new URL(s, OFF_BASE);
    if (u.protocol === 'http:') u.protocol = 'https:';
    return u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

const firstBrand = (v: unknown): string | null => str(typeof v === 'string' ? v.split(',')[0] : null);
const nameOf = (p: Json): string | null => str(p.product_name_es) ?? str(p.product_name);

function nutriscore(v: unknown): string | null {
  const g = str(v)?.toLowerCase() ?? '';
  return /^[a-e]$/.test(g) ? g : null;
}

function nova(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 4 ? n : null;
}

/** The 14 EU allergens (and a few frequent tags) in Spanish. */
const ALLERGENS_ES: Record<string, string> = {
  milk: 'leche', gluten: 'gluten', eggs: 'huevo', egg: 'huevo', nuts: 'frutos de cáscara',
  peanuts: 'cacahuetes', soybeans: 'soja', soy: 'soja', fish: 'pescado', crustaceans: 'crustáceos',
  molluscs: 'moluscos', celery: 'apio', mustard: 'mostaza', 'sesame-seeds': 'sésamo',
  'sulphur-dioxide-and-sulphites': 'sulfitos', lupin: 'altramuces',
};

/** "en:milk" → "leche"; "es:avellana" → "avellana"; unknown tags lose prefix and dashes. */
export function tagLabel(tag: string, dict: Record<string, string> = {}): string | null {
  const m = /^(?:([a-z]{2}):)?(.+)$/.exec(tag.trim().toLowerCase());
  if (!m) return null;
  const [, lang, value] = m;
  if ((!lang || lang === 'en') && dict[value!]) return dict[value!]!;
  return str(value!.replace(/-/g, ' '));
}

function labels(v: unknown, dict?: Record<string, string>): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const t of v) {
    const l = typeof t === 'string' ? tagLabel(t, dict) : null;
    if (l && !out.includes(l)) out.push(l);
  }
  return out;
}

/** One search hit as a product card; null when it has no barcode or no name. */
export function offProduct(p: unknown): Product | null {
  if (!isObj(p)) return null;
  const ean = barcode(p.code);
  const name = nameOf(p);
  if (!ean || !name) return null;
  const quantity = str(p.quantity);
  const details: ProductDetails = { nutriscore: nutriscore(p.nutriscore_grade), nova: nova(p.nova_group), quantity };
  return {
    key: `ean:${ean.padStart(13, '0')}`,
    name,
    brand: firstBrand(p.brands),
    sizeText: quantity,
    ean,
    image: httpsUrl(p.image_front_small_url) ?? httpsUrl(p.image_front_url),
    offers: [],
    details,
  };
}

/** A search answer as product cards, de-duplicated by key, bad hits skipped. */
export function mapOffSearch(json: unknown): Product[] {
  const products = isObj(json) && Array.isArray(json.products) ? json.products : [];
  const out: Product[] = [];
  const seen = new Set<string>();
  for (const p of products) {
    const card = offProduct(p);
    if (!card || seen.has(card.key)) continue;
    seen.add(card.key);
    out.push(card);
    if (out.length >= OFF_PAGE_SIZE) break;
  }
  return out;
}

/** A product answer as details; null when OFF does not know the product. */
export function mapOffDetails(json: unknown): ProductDetails | null {
  if (!isObj(json) || json.status === 0 || json.status === '0' || !isObj(json.product)) return null;
  const p = json.product;
  const images: string[] = [];
  for (const u of [p.image_front_url, p.image_url, p.image_front_small_url]) {
    const h = httpsUrl(u);
    if (h && !images.includes(h)) images.push(h);
  }
  return {
    nutriscore: nutriscore(p.nutriscore_grade),
    nova: nova(p.nova_group),
    ingredients: str(p.ingredients_text_es),
    allergens: labels(p.allergens_tags, ALLERGENS_ES),
    categories: labels(p.categories_tags),
    quantity: str(p.quantity),
    images,
  };
}

/** At most `max` calls in any `ms` window, per isolate. */
class RateWindow {
  private stamps: number[] = [];
  constructor(private readonly max: number, private readonly ms: number) {}
  take(now: number): boolean {
    this.stamps = this.stamps.filter((t) => now - t < this.ms && t <= now);
    if (this.stamps.length >= this.max) return false;
    this.stamps.push(now);
    return true;
  }
}

async function fail(res: Response, what: string): Promise<never> {
  await res.body?.cancel().catch(() => undefined);
  if (res.status === 403 || res.status === 429) throw new BlockedError(res.status, `openfoodfacts: ${what} blocked (${res.status})`);
  throw new Error(`openfoodfacts: ${what} HTTP ${res.status}`);
}

export interface OpenFoodFactsSource {
  /** Product cards for a submitted search (Spain, page 1, up to 12). */
  search(query: string, ctx: AdapterCtx): Promise<Product[]>;
  /** Details for a barcode; null when OFF does not know it. */
  details(ean: string, ctx: AdapterCtx): Promise<ProductDetails | null>;
}

export function createOpenFoodFacts(limits = { searchesPerMinute: 10, readsPerMinute: 15 }): OpenFoodFactsSource {
  const searches = new RateWindow(limits.searchesPerMinute, 60_000);
  const reads = new RateWindow(limits.readsPerMinute, 60_000);
  return {
    async search(query, ctx) {
      if (normaliseQuery(query).length < 2) return [];
      if (!searches.take(ctx.now.getTime())) throw new Error('openfoodfacts: 10 searches a minute reached, try again in a minute');
      const res = await ctx.fetch(offSearchUrl(query), { kind: 'search', headers: { accept: 'application/json' } });
      if (!res.ok) return fail(res, 'search');
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new Error('openfoodfacts: search answered something that is not JSON');
      }
      return mapOffSearch(json);
    },
    async details(ean, ctx) {
      const code = barcode(ean);
      if (!code) return null;
      if (!reads.take(ctx.now.getTime())) throw new Error('openfoodfacts: 15 product reads a minute reached, try again in a minute');
      const res = await ctx.fetch(offDetailsUrl(code), { kind: 'detail', headers: { accept: 'application/json' } });
      if (res.status === 404) {
        await res.body?.cancel().catch(() => undefined);
        return null;
      }
      if (!res.ok) return fail(res, 'details');
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new Error('openfoodfacts: details answered something that is not JSON');
      }
      return mapOffDetails(json);
    },
  };
}

export const openFoodFacts: OpenFoodFactsSource = createOpenFoodFacts();
