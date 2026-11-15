/**
 * The polite fetch every live source receives (AdapterCtx.fetch).
 *
 * What it guarantees, whatever the adapter does:
 *   - an honest user agent naming this project (any user agent the adapter sets is replaced);
 *   - one request at a time per host inside the isolate, and at least 1 s between the
 *     start of one request and the next to the same host (a promise queue per host);
 *   - an 8 s timeout per request, body included (AbortController plus a race, so a fetch
 *     that ignores the signal still gives up);
 *   - a request budget per instance: the routes make one instance per chain per search
 *     or hunt, with at most 4 page requests ('search' and 'detail') and 2 index requests
 *     ('index': sitemaps and category lists, cached 24 h), so a chain is asked at most
 *     4 times per hunt plus, at most once a day, its index;
 *   - the Cache API (caches.default when present; absent in tests): GET requests, and POST
 *     requests that pass an explicit cacheKey, are kept for 6 h ('search'), 12 h ('detail')
 *     or 24 h ('index'), under a synthetic key
 *     https://cache.cesta-compra.internal/<namespace>/<kind>/<sha-256 of method, url, cacheKey>.
 *     Only 200 answers are stored. Answers served from the cache carry `x-cesta-cache: hit`,
 *     fresh ones that were stored `x-cesta-cache: miss`.
 *
 * Everything is injectable (doFetch, cache, clock, sleep, spacer) so tests run offline.
 */
import type { FetchKind, PoliteFetch } from './types';

export const USER_AGENT = 'cesta-compra/0.2 (+https://github.com/pow-paulinho/cesta-compra; uso personal)';
export const MIN_SPACING_MS = 1000;
export const TIMEOUT_MS = 8000;
export const TTL_SECONDS: Record<FetchKind, number> = { search: 6 * 3600, detail: 12 * 3600, index: 24 * 3600 };
export const CACHE_ORIGIN = 'https://cache.cesta-compra.internal';
export const CACHE_HEADER = 'x-cesta-cache';
const STORED_AT_HEADER = 'x-cesta-stored-at';

/** The request took longer than the timeout and was aborted. */
export class TimeoutError extends Error {
  constructor(public readonly host: string, public readonly ms: number) {
    super(`timeout after ${ms} ms at ${host}`);
    this.name = 'TimeoutError';
  }
}

/** The instance already made as many requests as it may. Nothing was sent. */
export class BudgetError extends Error {
  constructor(public readonly namespace: string, public readonly max: number, kind: FetchKind) {
    super(`request budget reached for ${namespace}: at most ${max} ${kind === 'index' ? 'index' : 'page'} requests`);
    this.name = 'BudgetError';
  }
}

export interface SpacerOptions {
  spacingMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One queue per host: a request starts when the previous one to that host has finished
 * and at least `spacingMs` have passed since that previous one started.
 */
export class HostSpacer {
  private readonly tails = new Map<string, Promise<void>>();
  private readonly lastStart = new Map<string, number>();
  private readonly spacingMs: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(opts: SpacerOptions = {}) {
    this.spacingMs = opts.spacingMs ?? MIN_SPACING_MS;
    this.now = opts.now ?? Date.now;
    this.sleep = opts.sleep ?? realSleep;
  }

  schedule<T>(host: string, task: () => Promise<T>): Promise<T> {
    const prev = this.tails.get(host) ?? Promise.resolve();
    const run = prev.then(async () => {
      const last = this.lastStart.get(host);
      if (last !== undefined) {
        const wait = last + this.spacingMs - this.now();
        if (wait > 0) await this.sleep(wait);
      }
      this.lastStart.set(host, this.now());
      return task();
    });
    const tail = run.then(() => undefined, () => undefined);
    this.tails.set(host, tail);
    // Forget an idle host so the map does not grow with every host ever seen.
    void tail.then(() => {
      if (this.tails.get(host) === tail) this.tails.delete(host);
    });
    return run;
  }
}

/** Shared by every polite fetch of this isolate unless a test passes its own. */
export const ISOLATE_SPACER = new HostSpacer();

export interface FetchStats {
  /** Requests that went to the network (budget counted). */
  network: number;
  /** Answers served from the cache. */
  hits: number;
}

export type PoliteFetchWithStats = PoliteFetch & { readonly stats: FetchStats };

export interface PoliteFetchOptions {
  doFetch?: typeof fetch;
  /** caches.default in the Worker; undefined or null in tests. */
  cache?: Cache | null;
  /** Clock in ms, for the cache's own expiry check. */
  now?: () => number;
  spacer?: HostSpacer;
  timeoutMs?: number;
  /** Cache key namespace, usually the chain id; defaults to the request's host. */
  namespace?: string;
  /** Page requests ('search' and 'detail') this instance may send. */
  maxRequests?: number;
  /** Index requests this instance may send. */
  maxIndexRequests?: number;
  userAgent?: string;
}

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

/** The default Cache API store, or undefined where there is none (Node, tests). */
export function defaultCache(): Cache | undefined {
  const c = (globalThis as { caches?: { default?: Cache } }).caches;
  return c?.default;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The synthetic cache URL for a request. */
export async function cacheUrl(namespace: string, kind: FetchKind, method: string, url: string, cacheKey?: string): Promise<string> {
  const ns = encodeURIComponent(namespace.toLowerCase());
  return `${CACHE_ORIGIN}/${ns}/${kind}/${await sha256Hex(`${method} ${url} ${cacheKey ?? ''}`)}`;
}

function withHeader(res: Response, body: ArrayBuffer | null, name: string, value: string): Response {
  const headers = new Headers(res.headers);
  headers.set(name, value);
  return new Response(NULL_BODY_STATUS.has(res.status) ? null : body, { status: res.status, statusText: res.statusText, headers });
}

export function makePoliteFetch(opts: PoliteFetchOptions = {}): PoliteFetchWithStats {
  const doFetch = opts.doFetch ?? ((input: RequestInfo | URL, init?: RequestInit) => fetch(input, init));
  const cache = opts.cache ?? undefined;
  const now = opts.now ?? Date.now;
  const spacer = opts.spacer ?? ISOLATE_SPACER;
  const timeoutMs = opts.timeoutMs ?? TIMEOUT_MS;
  const maxPages = opts.maxRequests ?? Number.POSITIVE_INFINITY;
  const maxIndex = opts.maxIndexRequests ?? Number.POSITIVE_INFINITY;
  const userAgent = opts.userAgent ?? USER_AGENT;
  const stats: FetchStats = { network: 0, hits: 0 };
  let pages = 0;
  let indexes = 0;

  const polite = async (url: string, init: RequestInit & { kind?: FetchKind; cacheKey?: string } = {}): Promise<Response> => {
    const { kind: givenKind, cacheKey, ...rest } = init;
    const kind: FetchKind = givenKind ?? 'search';
    const method = (rest.method ?? 'GET').toUpperCase();
    const target = new URL(url);
    const namespace = opts.namespace ?? target.host;
    const cacheable = !!cache && (method === 'GET' || (method === 'POST' && typeof cacheKey === 'string' && cacheKey.length > 0));
    const ttl = TTL_SECONDS[kind];
    const key = cacheable ? new Request(await cacheUrl(namespace, kind, method, target.href, cacheKey)) : null;

    if (cache && key) {
      const hit = await cache.match(key).catch(() => undefined);
      if (hit) {
        const storedAt = Number(hit.headers.get(STORED_AT_HEADER));
        if (Number.isFinite(storedAt) && storedAt > 0 && now() - storedAt <= ttl * 1000) {
          stats.hits++;
          return withHeader(hit, await hit.arrayBuffer(), CACHE_HEADER, 'hit');
        }
        await hit.body?.cancel().catch(() => undefined);
        await cache.delete(key).catch(() => false);
      }
    }

    if (kind === 'index') {
      if (indexes >= maxIndex) throw new BudgetError(namespace, maxIndex, kind);
      indexes++;
    } else {
      if (pages >= maxPages) throw new BudgetError(namespace, maxPages, kind);
      pages++;
    }

    const headers = new Headers(rest.headers);
    headers.set('user-agent', userAgent);
    if (!headers.has('accept-language')) headers.set('accept-language', 'es-ES,es;q=0.9');

    const { res, body } = await spacer.schedule(target.host, async () => {
      stats.network++;
      const ac = new AbortController();
      const outer = rest.signal;
      const onOuterAbort = () => ac.abort(outer?.reason);
      if (outer) {
        if (outer.aborted) ac.abort(outer.reason);
        else outer.addEventListener('abort', onOuterAbort);
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          ac.abort();
          reject(new TimeoutError(target.host, timeoutMs));
        }, timeoutMs);
      });
      try {
        const r = await Promise.race([doFetch(target.href, { ...rest, method, headers, signal: ac.signal }), deadline]);
        const b = NULL_BODY_STATUS.has(r.status) ? null : await Promise.race([r.arrayBuffer(), deadline]);
        return { res: r, body: b };
      } finally {
        clearTimeout(timer);
        outer?.removeEventListener('abort', onOuterAbort);
      }
    });

    const out = new Headers(res.headers);
    // The body is already decoded and buffered: these no longer describe it.
    out.delete('content-encoding');
    out.delete('content-length');
    const fresh = () => new Response(NULL_BODY_STATUS.has(res.status) ? null : body, { status: res.status, statusText: res.statusText, headers: out });

    if (cache && key && res.status === 200) {
      const stored = new Headers(out);
      stored.delete('set-cookie');
      stored.delete('vary');
      stored.set('cache-control', `public, max-age=${ttl}`);
      stored.set(STORED_AT_HEADER, String(now()));
      try {
        await cache.put(key, new Response(body, { status: 200, headers: stored }));
        out.set(CACHE_HEADER, 'miss');
      } catch {
        // A cache that refuses to store is not a reason to fail the request.
      }
    }
    return fresh();
  };

  return Object.assign(polite, { stats }) as PoliteFetchWithStats;
}
