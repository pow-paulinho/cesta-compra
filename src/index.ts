import { checkoutCart, searchProducts } from './api';
import { KeyThrottle, LIVE_KEY_HEADER, clientId, liveAccess } from './live/auth';
import { defaultDeps, json, readBodyText, type LiveDeps } from './live/common';
import { handleDetails, liveStatus } from './live/details';
import { handleHunt } from './live/hunt';
import { handleSearch } from './live/search';
import { fetchOpenPrices, type FetchPlan, type OpenPrice } from './sources/openprices';
import { logImport, saveOpenPrices, seedDemo, status } from './store';

export interface Env {
  DB: D1Database;
  /** The built web app (dist/client), served by Workers static assets. */
  ASSETS?: Fetcher;
  /** The owner's key for live supermarket search (a secret; see .dev.vars.example). */
  LIVE_KEY?: string;
}

export function health(): { ok: true; app: string } {
  return { ok: true, app: 'cesta-compra' };
}

/** How long one Open Prices request may take, body included, before the import moves on. */
export const IMPORT_REQUEST_TIMEOUT_MS = 15_000;

/**
 * A fetch for the importer that never throws: a network error, a timeout (15 s, body
 * included) or a 200 whose body is not JSON comes back as an empty error answer, which the
 * importer skips like any other failed page; error bodies are cancelled, not left open. So
 * one bad request costs one page, never the whole run.
 */
export function sturdyFetch(doFetch: typeof fetch, failures: { count: number; last: string | null }, timeoutMs = IMPORT_REQUEST_TIMEOUT_MS): typeof fetch {
  const failed = (status: number, why: string): Response => {
    failures.count += 1;
    failures.last = why;
    return new Response(null, { status });
  };
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    // Abort plus a race, so a fetch that ignores the signal still gives up.
    const ac = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ac.abort();
        reject(new Error(`timeout after ${timeoutMs} ms`));
      }, timeoutMs);
    });
    deadline.catch(() => undefined);
    try {
      const res = await Promise.race([doFetch(input, { ...init, signal: ac.signal }), deadline]);
      if (!res.ok) {
        await res.body?.cancel().catch(() => undefined);
        return failed(res.status, `HTTP ${res.status}`);
      }
      const text = await Promise.race([res.text(), deadline]);
      try {
        JSON.parse(text);
      } catch {
        return failed(502, 'answer is not JSON');
      }
      return new Response(text, { status: res.status, headers: res.headers });
    } catch (err) {
      return failed(504, err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timer);
    }
  }) as typeof fetch;
}

export interface ImportOptions {
  plan?: FetchPlan;
  wait?: (ms: number) => Promise<void>;
}

/**
 * The daily import: demo prices (idempotent), then Open Prices, politely. A request that
 * fails is skipped (sturdyFetch), the prices read are saved, and the run is always logged,
 * also when saving fails; failed requests go to the Worker log.
 */
export async function runImport(env: Env, now = new Date(), doFetch: typeof fetch = fetch, opts: ImportOptions = {}) {
  const demo = await seedDemo(env.DB);
  const failures = { count: 0, last: null as string | null };
  let read = { prices: [] as OpenPrice[], requests: 0, skipped: 0 };
  let saved = 0;
  try {
    read = await fetchOpenPrices(sturdyFetch(doFetch, failures), opts.plan, opts.wait);
    saved = await saveOpenPrices(env.DB, read.prices);
  } finally {
    if (failures.count) console.warn(`open prices import: ${failures.count} of ${read.requests} requests failed (last: ${failures.last})`);
    await logImport(env.DB, 'open_prices', read.requests, saved, read.skipped, now);
  }
  return { demo, openPrices: saved, requests: read.requests, skipped: read.skipped, failed: failures.count };
}

/* One set of live dependencies per isolate, so the polite fetch's per-host spacing holds
   across requests. Built lazily: caches.default only exists inside the Workers runtime. */
let deps: LiveDeps | null = null;
const liveDeps = (): LiveDeps => (deps ??= defaultDeps());

const methodNotAllowed = (allow: string) => json({ error: `Método no permitido: usa ${allow}.` }, 405, { allow });

/** Largest body /api/checkout reads (60 items of {ean, qty} take about 2 KB). */
export const CHECKOUT_MAX_BYTES = 8 * 1024;

const SERVER_FAILED = 'El servidor ha fallado. Vuelve a intentarlo en un momento.';
const CATALOGUE_DOWN = 'El catálogo de precios no está disponible ahora mismo. Vuelve a intentarlo en un momento.';
const isD1Error = (m: string): boolean => /D1_|SQLITE|no such table|database/i.test(m);

async function checkoutBody(request: Request): Promise<unknown | Response> {
  const read = await readBodyText(request, CHECKOUT_MAX_BYTES);
  if (!read.ok) {
    return read.why === 'too-large'
      ? json({ error: `El cuerpo pasa de ${CHECKOUT_MAX_BYTES} bytes.` }, 413)
      : json({ error: 'No hemos podido leer el cuerpo.' }, 400);
  }
  try {
    return JSON.parse(read.text) as unknown;
  } catch {
    return null;
  }
}

/** The routes that read the live key, and the throttle on wrong keys sent to them. */
const KEY_ROUTES = new Set(['/api/live', '/api/search', '/api/hunt']);
const keyThrottle = new KeyThrottle();
const TOO_MANY_WRONG_KEYS = 'Demasiados intentos con una clave que no coincide. Espera unos minutos y revisa la clave en Ajustes.';

/** 429 while this client has sent too many wrong keys lately; counts this one when it is wrong. */
function throttleKey(request: Request, env: Env, path: string): Response | null {
  if (!KEY_ROUTES.has(path) || !request.headers.get(LIVE_KEY_HEADER)) return null;
  const client = clientId(request);
  const now = Date.now();
  const wait = keyThrottle.waitMs(client, now);
  if (wait > 0) return json({ error: TOO_MANY_WRONG_KEYS }, 429, { 'retry-after': String(Math.ceil(wait / 1000)) });
  if (liveAccess(env, request) === 'wrong') keyThrottle.recordWrong(client, now);
  return null;
}

async function route(request: Request, env: Env, url: URL, ctx?: ExecutionContext): Promise<Response> {
  const path = url.pathname;
  const waitUntil = ctx ? (p: Promise<unknown>) => ctx.waitUntil(p) : undefined;
  const throttled = throttleKey(request, env, path);
  if (throttled) return throttled;
  if (path === '/api/status') return Response.json(await status(env.DB));
  if (path === '/api/products') return Response.json(await searchProducts(env.DB, url.searchParams.get('q') ?? ''));
  if (path === '/api/checkout') {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const body = await checkoutBody(request);
    if (body instanceof Response) return body;
    const r = await checkoutCart(env.DB, body);
    return r ? Response.json(r) : Response.json({ error: 'items: 1–60 of {ean, qty 1–99}; maxStores 1–7; source demo|open_prices' }, { status: 400 });
  }
  if (path === '/api/search') return request.method === 'GET' ? handleSearch(request, env, liveDeps(), waitUntil) : methodNotAllowed('GET');
  if (path === '/api/hunt') return request.method === 'POST' ? handleHunt(request, env, liveDeps(), waitUntil) : methodNotAllowed('POST');
  if (path === '/api/details') return request.method === 'GET' ? handleDetails(request, liveDeps()) : methodNotAllowed('GET');
  if (path === '/api/live') return request.method === 'GET' ? json(liveStatus(env, request, liveDeps())) : methodNotAllowed('GET');
  return json({ error: `No existe ${path}.` }, 404);
}

/**
 * The API routes. A failure that escapes a route (a D1 error on /api/status, /api/products
 * or /api/checkout) answers JSON the web app can read, never the runtime's error page and
 * never the raw message, which goes to the log.
 */
async function api(request: Request, env: Env, url: URL, ctx?: ExecutionContext): Promise<Response> {
  try {
    return await route(request, env, url, ctx);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`${url.pathname} failed: ${message}`);
    return isD1Error(message) ? json({ error: CATALOGUE_DOWN }, 503) : json({ error: SERVER_FAILED }, 500);
  }
}

export default {
  async fetch(request: Request, env: Env, ctx?: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json(health());
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return api(request, env, url, ctx);
    // Everything else is the web app. With run_worker_first, the assets layer answers these
    // before the Worker runs; this covers local runs and paths routed here anyway.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  },
  /* Awaited, not handed to waitUntil (CC-3): waitUntil work is cancelled about 30 s
     after the handler returns, and the polite Open Prices reader takes longer. A
     scheduled handler may run for minutes while it is still awaiting. */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await runImport(env);
  },
} satisfies ExportedHandler<Env>;
