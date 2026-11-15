/**
 * Open Prices (prices.openfoodfacts.org): open, crowdsourced shelf prices.
 *
 * Politeness: one request at a time, at least 1.1 s apart, an honest
 * user-agent naming this project, and a hard cap on requests per run
 * (90: up to 8 location pages and 4 price pages per chain, about 100 s for
 * the awaited daily cron). prices.openfoodfacts.org serves an empty
 * robots.txt. This importer never calls a supermarket website; the live
 * adapters in ./live do that, under their own rules.
 *
 * Locations are paged (`page=1..pages`, at most 8 pages per chain) because
 * the search is worldwide: on 2026-11-15 Carrefour had 23 Spanish locations
 * of which only 4 were on page 1, Lidl 39 of which 5.
 */
export const USER_AGENT = 'cesta-compra/0.1 (+https://github.com/pow-paulinho/cesta-compra)';
/** Chain names as OpenStreetMap writes them (and as the catalogue stores them, see shared/chains.ts). */
export const CHAINS = [
  'Mercadona', 'Dia', 'Consum', 'Carrefour', 'Alcampo', 'Eroski', 'Lidl',
  'Aldi', 'Ahorramas', 'BM', 'El Corte Inglés',
] as const;
export type OpenPricesChain = (typeof CHAINS)[number];
export const BASE = 'https://prices.openfoodfacts.org/api/v1';

/**
 * What to ask /locations for when it differs from the chain name: the filter is a
 * substring match, and "Corte Ingl" finds both "El Corte Inglés" and "El Corte Ingles".
 */
const LOCATION_QUERY: Partial<Record<OpenPricesChain, string>> = { 'El Corte Inglés': 'Corte Ingl' };

export interface OpenPrice {
  ean: string;
  name: string;
  brand: string | null;
  size: string | null;
  chain: string;
  priceCents: number;
  observedOn: string;
  place: string | null;
}

interface Location { id: number; osm_name?: string; osm_address_country?: string; osm_address_city?: string; price_count?: number }
interface PriceItem {
  product_code?: string | null; price?: number; currency?: string | null; date?: string | null;
  product?: { product_name?: string | null; brands?: string | null; product_quantity?: number | null; product_quantity_unit?: string | null } | null;
}

export const isSpain = (country: string | undefined): boolean => /^(españa|spain|espanya)$/i.test((country ?? '').trim());

const fold = (s: string): string => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Each chain as a whole-word pattern: "BM" matches "BM Supermercados", never "BMW" or "Ambm". */
const CHAIN_PATTERNS = CHAINS.map((c) => [c, new RegExp(`(^|[^a-z0-9])${escapeRe(fold(c))}([^a-z0-9]|$)`)] as const);

/** The chain a location belongs to, from its OSM name (whole words, accents ignored); null when it is none of ours. */
export function chainOf(osmName: string | undefined): OpenPricesChain | null {
  const n = fold(osmName ?? '');
  return CHAIN_PATTERNS.find(([, re]) => re.test(n))?.[0] ?? null;
}

/** One Open Prices item as a price we can store, or null when it cannot be compared. */
export function toPrice(item: PriceItem, chain: string, place: string | null): OpenPrice | null {
  const ean = (item.product_code ?? '').trim();
  if (!/^\d{8,14}$/.test(ean)) return null;
  if (typeof item.price !== 'number' || !(item.price > 0)) return null;
  if (item.currency && item.currency !== 'EUR') return null;
  if (!item.date || !/^\d{4}-\d{2}-\d{2}/.test(item.date)) return null;
  const p = item.product ?? {};
  const name = (p.product_name ?? '').trim();
  if (!name) return null;
  const size = p.product_quantity ? `${p.product_quantity} ${p.product_quantity_unit ?? ''}`.trim() : null;
  return {
    ean, name, brand: (p.brands ?? '').split(',')[0]?.trim() || null, size,
    chain, priceCents: Math.round(item.price * 100), observedOn: item.date.slice(0, 10), place,
  };
}

export interface FetchPlan {
  maxRequests: number;
  locationsPerChain: number;
  delayMs: number;
  /** Location pages read per chain at most (default 8). */
  maxLocationPages?: number;
}
export const DEFAULT_PLAN: FetchPlan = { maxRequests: 90, locationsPerChain: 4, delayMs: 1100, maxLocationPages: 8 };
export const MAX_LOCATION_PAGES = 8;

/** Reads Spanish supermarket prices from Open Prices, politely. */
export async function fetchOpenPrices(
  doFetch: typeof fetch,
  plan: FetchPlan = DEFAULT_PLAN,
  wait: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<{ prices: OpenPrice[]; requests: number; skipped: number }> {
  let requests = 0;
  let skipped = 0;
  const get = async <T>(path: string): Promise<T | null> => {
    if (requests >= plan.maxRequests) return null;
    if (requests > 0) await wait(plan.delayMs);
    requests += 1;
    const res = await doFetch(`${BASE}${path}`, { headers: { 'user-agent': USER_AGENT, accept: 'application/json' } });
    return res.ok ? ((await res.json()) as T) : null;
  };
  const maxPages = Math.max(1, Math.min(plan.maxLocationPages ?? MAX_LOCATION_PAGES, MAX_LOCATION_PAGES));
  const prices: OpenPrice[] = [];
  for (const chain of CHAINS) {
    const like = encodeURIComponent(LOCATION_QUERY[chain] ?? chain);
    const found = new Map<number, Location>();
    for (let page = 1; page <= maxPages; page++) {
      const locs = await get<{ items?: Location[]; pages?: number }>(`/locations?osm_name__like=${like}&size=100&page=${page}`);
      const items = Array.isArray(locs?.items) ? locs.items : [];
      for (const l of items) {
        if (typeof l?.id === 'number' && isSpain(l.osm_address_country) && chainOf(l.osm_name) === chain && (l.price_count ?? 0) > 0) {
          found.set(l.id, l);
        }
      }
      const pages = typeof locs?.pages === 'number' && Number.isFinite(locs.pages) ? locs.pages : 1;
      if (!locs || items.length === 0 || page >= pages) break;
    }
    const spanish = [...found.values()]
      .sort((a, b) => (b.price_count ?? 0) - (a.price_count ?? 0))
      .slice(0, plan.locationsPerChain);
    for (const loc of spanish) {
      const page = await get<{ items?: PriceItem[] }>(`/prices?location_id=${loc.id}&size=100&order_by=-date`);
      for (const item of page?.items ?? []) {
        const p = toPrice(item, chain, loc.osm_address_city ?? null);
        if (p) prices.push(p); else skipped += 1;
      }
    }
  }
  return { prices, requests, skipped };
}
