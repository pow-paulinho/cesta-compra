/**
 * Open Prices (prices.openfoodfacts.org): open, crowdsourced shelf prices.
 *
 * Politeness: one request at a time, at least 1.1 s apart, an honest
 * user-agent naming this project, and a hard cap on requests per run.
 * Supermarket websites are never called: their robots.txt disallows the
 * price APIs and their allowed pages render prices in the browser only.
 */
export const USER_AGENT = 'cesta-compra/0.1 (+https://github.com/pow-paulinho/cesta-compra)';
export const CHAINS = ['Mercadona', 'Dia', 'Consum', 'Carrefour', 'Alcampo', 'Eroski', 'Lidl'] as const;
export const BASE = 'https://prices.openfoodfacts.org/api/v1';

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

/** The chain a location belongs to, from its OSM name; null when it is none of ours. */
export function chainOf(osmName: string | undefined): string | null {
  const n = (osmName ?? '').toLowerCase();
  return CHAINS.find((c) => new RegExp(`(^|\\W)${c.toLowerCase()}(\\W|$)`).test(n)) ?? null;
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

export interface FetchPlan { maxRequests: number; locationsPerChain: number; delayMs: number }
export const DEFAULT_PLAN: FetchPlan = { maxRequests: 40, locationsPerChain: 4, delayMs: 1100 };

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
  const prices: OpenPrice[] = [];
  for (const chain of CHAINS) {
    const locs = await get<{ items?: Location[] }>(`/locations?osm_name__like=${encodeURIComponent(chain)}&size=100`);
    const spanish = (locs?.items ?? [])
      .filter((l) => isSpain(l.osm_address_country) && chainOf(l.osm_name) === chain && (l.price_count ?? 0) > 0)
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
