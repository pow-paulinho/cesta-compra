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
import { BlockedError, SourceError, type AdapterCtx, type ChainAdapter, type PoliteFetch } from '../sources/live/types';

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
  /** Waits before a retry (tests pass a fake one); a real timer by default. */
  sleep?(ms: number): Promise<void>;
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

/** The work was called off (deadline passed, or the client went away) before this request. */
export class AbortedError extends Error {
  constructor(what: string) {
    super(`${what}: called off`);
    this.name = 'AbortError';
  }
}

/**
 * `work`, or DeadlineError after `ms`. When `controller` is given it is aborted at the
 * deadline, so the adapter behind `work` stops at its next request instead of running on.
 */
export function withDeadline<T>(work: Promise<T>, ms: number, what: string, controller?: AbortController): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const err = new DeadlineError(what, ms);
      controller?.abort(err);
      reject(err);
    }, ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** A controller that also aborts when `parent` does (the client went away). */
export function childController(parent?: AbortSignal): AbortController {
  const ac = new AbortController();
  if (parent) {
    if (parent.aborted) ac.abort(parent.reason);
    else parent.addEventListener('abort', () => ac.abort(parent.reason), { once: true });
  }
  return ac;
}

/** What the context saw of the answers, for the caller's retry decision. */
export interface CtxMeta {
  /** The last answer's Retry-After, in ms; null when it had none. */
  retryAfterMs: number | null;
}

/** A Retry-After header (seconds, or an HTTP date) in ms from `now`; null when absent or unreadable. */
export function retryAfterMs(value: string | null, now: number): number | null {
  if (value === null || value.trim() === '') return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
}

/**
 * A context for one adapter call, and the fetch behind it (for its cache stats). With a
 * signal, every request carries it (an in-flight one is cancelled when it aborts) and no new
 * request starts once it has aborted: the adapter's loop ends at its next ctx.fetch.
 */
export function adapterCtx(namespace: string, deps: LiveDeps, signal?: AbortSignal): { ctx: AdapterCtx; fetch: PoliteFetchWithStats; meta: CtxMeta } {
  const fetch = deps.fetchFor(namespace);
  const meta: CtxMeta = { retryAfterMs: null };
  const guarded: PoliteFetch = async (url, init = {}) => {
    if (signal?.aborted) throw new AbortedError(namespace);
    const own = init.signal;
    const merged = own && signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([own, signal]) : own ?? signal;
    const res = await fetch(url, merged ? { ...init, signal: merged } : init);
    meta.retryAfterMs = retryAfterMs(res.headers.get('retry-after'), Date.now());
    return res;
  };
  return { ctx: { fetch: guarded, now: deps.now() }, fetch, meta };
}

/** How long to wait before the one retry of a source that answered 502, 503 or 504. */
export const RETRY_DELAY_MS = 1500;
/** A longer Retry-After is not waited for: the source answers "error" at once. */
export const RETRY_AFTER_MAX_MS = 5000;
const TRANSIENT = new Set([502, 503, 504]);

/** 502/503/504 carried by an error (its status, or "HTTP 503" in our own messages); null otherwise. */
export function transientStatus(err: unknown): number | null {
  if (isBlocked(err)) return null;
  const s = httpStatusOf(err) ?? Number(/\bHTTP (\d{3})\b/.exec(err instanceof Error ? err.message : '')?.[1] ?? NaN);
  return TRANSIENT.has(s) ? s : null;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * `work`, asked once more after RETRY_DELAY_MS (or a Retry-After of up to 5 s) when it fails
 * with 502/503/504: a source such as Open Food Facts answers 503 now and then and the same
 * request works seconds later. Never retried: refusals (403/429), timeouts, other errors, a
 * longer Retry-After, or work already called off. The retry goes through the same polite
 * fetch, so per-host spacing and the source's own rate window still apply.
 */
export async function retryOnceIfUnavailable<T>(
  work: () => Promise<T>,
  opts: { signal?: AbortSignal; sleep?: (ms: number) => Promise<void>; meta?: CtxMeta } = {},
): Promise<T> {
  try {
    return await work();
  } catch (err) {
    if (transientStatus(err) === null || opts.signal?.aborted) throw err;
    const asked = opts.meta?.retryAfterMs ?? null;
    if (asked !== null && asked > RETRY_AFTER_MAX_MS) throw err;
    await (opts.sleep ?? realSleep)(Math.max(RETRY_DELAY_MS, asked ?? 0));
    if (opts.signal?.aborted) throw err;
    return work();
  }
}

const validOffer = (o: unknown): o is Offer => {
  const x = o as Partial<Offer> | null;
  return !!x && typeof x.name === 'string' && x.name.trim() !== '' && typeof x.id === 'string'
    && typeof x.priceCents === 'number' && Number.isFinite(x.priceCents) && x.priceCents > 0;
};

/**
 * Runs one chain's adapter through a fresh polite fetch, under the deadline. Offers come
 * back stamped with the chain and source "live", and flagged cached when every answer
 * came from the cache. When the deadline passes, or `signal` aborts (the client went away),
 * the adapter's requests are called off: none is sent after that.
 */
export async function runAdapter(adapter: ChainAdapter, query: string, deps: LiveDeps, signal?: AbortSignal): Promise<Offer[]> {
  const controller = childController(signal);
  const { ctx, fetch } = adapterCtx(adapter.chain, deps, controller.signal);
  const offers = await withDeadline(adapter.search(query, ctx), deps.deadlineMs, adapter.chain, controller);
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
  return m.replace(/\s+/g, ' ').trim().slice(0, 300);
};

/** "HTTP 503" in one of our own error messages ("aldi: HTTP 503", "HTTP 503 for https://…"). */
const HTTP_IN_MESSAGE = /\bHTTP (\d{3})\b/;
/** Our own messages for an answer that came back but could not be read. */
const UNREADABLE = /not JSON|without product state|without product URLs|sitemap not found|unparseable|cannot be read/i;
/** A source's own per-minute window is full (Open Food Facts: 10 searches, 15 reads). */
const RATE_WINDOW = /a minute reached|per minute|por minuto/i;
/** Connection-level failures of the runtime's fetch. */
const NETWORK = /network|connection|fetch failed|socket|ECONN|ENOTFOUND|EAI_AGAIN|dns/i;

/**
 * A failure as a status and a reason in Spanish. The reason never carries raw error text
 * (runtime internals such as "internal error; reference = …", D1 or SQLite messages):
 * only a sentence of ours, at most with the HTTP status. The raw message goes to the log.
 */
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
  const userReason = (err as { userReason?: unknown } | null)?.userReason;
  if (err instanceof SourceError || (typeof userReason === 'string' && userReason)) {
    return { status: 'error', reason: String(userReason) };
  }
  const raw = shortMessage(err);
  console.error(`${label}: ${raw}`);
  const status = httpStatusOf(err) ?? Number(HTTP_IN_MESSAGE.exec(raw)?.[1] ?? NaN);
  if (Number.isInteger(status) && status >= 500) {
    return { status: 'error', reason: `${label} no está respondiendo bien ahora mismo (HTTP ${status}). Prueba otra vez en un rato.` };
  }
  if (Number.isInteger(status) && status >= 400) {
    return { status: 'error', reason: `${label} ha respondido con un error (HTTP ${status}).` };
  }
  if (RATE_WINDOW.test(raw)) {
    return { status: 'error', reason: `${label} solo admite unas pocas consultas por minuto: espera un minuto y vuelve a probar.` };
  }
  if (UNREADABLE.test(raw)) {
    return { status: 'error', reason: `${label} ha respondido algo que no sabemos leer; puede que haya cambiado su web.` };
  }
  if (NETWORK.test(raw)) {
    return { status: 'error', reason: `No hemos podido conectar con ${label}. Prueba otra vez en un rato.` };
  }
  return { status: 'error', reason: `No hemos podido leer ${label} por un fallo interno. Prueba otra vez en un momento.` };
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

/** What reading a request body up to a size gave: its text, or why there is none. */
export type BodyRead = { ok: true; text: string } | { ok: false; why: 'too-large' | 'unreadable' };

/**
 * The request body as text, read at most `maxBytes` far: a larger Content-Length is refused
 * before anything is read, and a body that streams past the limit is cancelled there, so a
 * huge body never sits in the isolate's memory.
 */
export async function readBodyText(request: Request, maxBytes: number): Promise<BodyRead> {
  const declared = request.headers.get('content-length');
  if (declared !== null && declared.trim() !== '' && !(Number(declared) <= maxBytes)) return { ok: false, why: 'too-large' };
  if (!request.body) return { ok: true, text: '' };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, why: 'too-large' };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, why: 'unreadable' };
  }
  const all = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) {
    all.set(c, at);
    at += c.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(all) };
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });
}
