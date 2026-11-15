/**
 * What the live routes share: their dependencies (injectable for tests), which chains are
 * searched live, running one adapter politely, turning failures into a status and a reason,
 * and grouping offers into product cards.
 */
import { matchKey } from '../match';
import { CHAINS } from '../shared/chains';
import type { ChainId, ChainStatus, Offer, Product } from '../shared/types';
import { BudgetError, TimeoutError, defaultCache, makePoliteFetch, type PoliteFetchWithStats } from '../sources/live/http';
import { LIVE_ADAPTERS, OFF, type CatalogueProvider } from '../sources/live/index';
import { BlockedError, type AdapterCtx, type ChainAdapter } from '../sources/live/types';

/** Page requests one chain may get per search or hunt (index requests are counted apart). */
export const REQUESTS_PER_CHAIN = 4;
export const INDEX_REQUESTS_PER_CHAIN = 2;
/** How long one chain may take, all its requests included, before it answers "error". */
export const CHAIN_DEADLINE_MS = 30_000;
/** Most product cards one source contributes to a search. */
export const PRODUCTS_PER_SOURCE = 24;

export interface LiveDeps {
  adapters: Partial<Record<ChainId, ChainAdapter>>;
  off: CatalogueProvider;
  /** A fresh polite fetch for one chain or source, for one search or hunt. */
  fetchFor(namespace: string): PoliteFetchWithStats;
  now(): Date;
  deadlineMs: number;
}

export function defaultDeps(): LiveDeps {
  const cache = defaultCache();
  return {
    adapters: LIVE_ADAPTERS,
    off: OFF,
    fetchFor: (namespace) =>
      makePoliteFetch({ cache, namespace, maxRequests: REQUESTS_PER_CHAIN, maxIndexRequests: INDEX_REQUESTS_PER_CHAIN }),
    now: () => new Date(),
    deadlineMs: CHAIN_DEADLINE_MS,
  };
}

/** The adapter a chain is searched live with, or null when it answers from the catalogue. */
export function liveAdapter(id: ChainId, adapters: Partial<Record<ChainId, ChainAdapter>>): ChainAdapter | null {
  const adapter = adapters[id];
  return CHAINS[id].mode === 'live' && adapter ? adapter : null;
}

/** Why a chain answers from the catalogue, in Spanish. */
export function fallbackReason(id: ChainId): string {
  return CHAINS[id].reason ?? `Aún no buscamos en ${CHAINS[id].name} en directo: usamos Open Prices.`;
}

/** The adapter (or source) took longer than the deadline. */
export class DeadlineError extends Error {
  constructor(public readonly what: string, public readonly ms: number) {
    super(`${what}: no answer within ${ms} ms`);
    this.name = 'DeadlineError';
  }
}

export function withDeadline<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new DeadlineError(what, ms)), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** A context for one adapter call, and the fetch behind it (for its cache stats). */
export function adapterCtx(namespace: string, deps: LiveDeps): { ctx: AdapterCtx; fetch: PoliteFetchWithStats } {
  const fetch = deps.fetchFor(namespace);
  return { ctx: { fetch, now: deps.now() }, fetch };
}

const validOffer = (o: unknown): o is Offer => {
  const x = o as Partial<Offer> | null;
  return !!x && typeof x.name === 'string' && x.name.trim() !== '' && typeof x.id === 'string'
    && typeof x.priceCents === 'number' && Number.isFinite(x.priceCents) && x.priceCents > 0;
};

/**
 * Runs one chain's adapter through a fresh polite fetch, under the deadline. Offers come
 * back stamped with the chain and source "live", and flagged cached when every answer
 * came from the cache.
 */
export async function runAdapter(adapter: ChainAdapter, query: string, deps: LiveDeps): Promise<Offer[]> {
  const { ctx, fetch } = adapterCtx(adapter.chain, deps);
  const offers = await withDeadline(adapter.search(query, ctx), deps.deadlineMs, adapter.chain);
  const cached = fetch.stats.network === 0 && fetch.stats.hits > 0;
  return (Array.isArray(offers) ? offers : [])
    .filter(validOffer)
    .map((o) => ({ ...o, chain: adapter.chain, source: 'live' as const, ...(cached || o.cached ? { cached: true } : {}) }));
}

function httpStatusOf(err: unknown): number | null {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : null;
}

/** True when the site refused us: BlockedError, or any error carrying status 403 or 429. */
export function isBlocked(err: unknown): boolean {
  if (err instanceof BlockedError) return true;
  if ((err as { name?: unknown } | null)?.name === 'BlockedError') return true;
  const s = httpStatusOf(err);
  return s === 403 || s === 429;
}

const shortMessage = (err: unknown): string => {
  const m = err instanceof Error ? err.message : String(err);
  return m.replace(/\s+/g, ' ').trim().slice(0, 140);
};

/** A failure as a status and a reason in Spanish (with the technical cause in brackets). */
export function failure(err: unknown, label: string): { status: ChainStatus; reason: string } {
  if (isBlocked(err)) {
    const s = httpStatusOf(err);
    return { status: 'blocked', reason: `${label} ha rechazado la consulta automática${s ? ` (HTTP ${s})` : ''}: no insistimos.` };
  }
  if (err instanceof DeadlineError || err instanceof TimeoutError) {
    return { status: 'error', reason: `${label} no ha respondido a tiempo. Prueba otra vez en un rato.` };
  }
  if (err instanceof BudgetError) {
    return { status: 'error', reason: `Hemos parado tras ${err.max} consultas a ${label} para no cargar su web.` };
  }
  return { status: 'error', reason: `No hemos podido leer ${label} (${shortMessage(err)}).` };
}

/** Offers of one source grouped into product cards (same EAN, or same brand, name and size). */
export function groupProducts(offers: Offer[], limit = PRODUCTS_PER_SOURCE): Product[] {
  const byKey = new Map<string, Product>();
  for (const o of offers) {
    const key = matchKey({ ean: o.ean, name: o.name, brand: o.brand, size: o.sizeText }).key;
    let p = byKey.get(key);
    if (!p) {
      p = { key, name: o.name, brand: o.brand, sizeText: o.sizeText, ean: o.ean, image: o.image, offers: [] };
      byKey.set(key, p);
    }
    p.image ??= o.image;
    p.brand ??= o.brand;
    p.sizeText ??= o.sizeText;
    p.ean ??= o.ean;
    if (!p.offers.some((x) => x.chain === o.chain && x.id === o.id)) p.offers.push(o);
  }
  const products = [...byKey.values()].slice(0, limit);
  for (const p of products) p.offers.sort((a, b) => a.priceCents - b.priceCents);
  return products;
}

/** Product cards of one source, de-duplicated by key (Open Food Facts may repeat a code). */
export function dedupeProducts(products: Product[], limit = PRODUCTS_PER_SOURCE): Product[] {
  const seen = new Set<string>();
  const out: Product[] = [];
  for (const p of products) {
    if (!p || typeof p.key !== 'string' || seen.has(p.key)) continue;
    seen.add(p.key);
    out.push(p);
    if (out.length >= limit) break;
  }
  return out;
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
}
