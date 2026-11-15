import { checkoutCart, searchProducts } from './api';
import { defaultDeps, json, type LiveDeps } from './live/common';
import { handleDetails, liveStatus } from './live/details';
import { handleHunt } from './live/hunt';
import { handleSearch } from './live/search';
import { fetchOpenPrices } from './sources/openprices';
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

/** The daily import: demo prices (idempotent), then Open Prices, politely. */
export async function runImport(env: Env, now = new Date(), doFetch: typeof fetch = fetch) {
  const demo = await seedDemo(env.DB);
  const { prices, requests, skipped } = await fetchOpenPrices(doFetch);
  const saved = await saveOpenPrices(env.DB, prices);
  await logImport(env.DB, 'open_prices', requests, saved, skipped, now);
  return { demo, openPrices: saved, requests, skipped };
}

/* One set of live dependencies per isolate, so the polite fetch's per-host spacing holds
   across requests. Built lazily: caches.default only exists inside the Workers runtime. */
let deps: LiveDeps | null = null;
const liveDeps = (): LiveDeps => (deps ??= defaultDeps());

const methodNotAllowed = (allow: string) => json({ error: `Método no permitido: usa ${allow}.` }, 405, { allow });

async function api(request: Request, env: Env, url: URL, ctx?: ExecutionContext): Promise<Response> {
  const path = url.pathname;
  const waitUntil = ctx ? (p: Promise<unknown>) => ctx.waitUntil(p) : undefined;
  if (path === '/api/status') return Response.json(await status(env.DB));
  if (path === '/api/products') return Response.json(await searchProducts(env.DB, url.searchParams.get('q') ?? ''));
  if (path === '/api/checkout') {
    if (request.method !== 'POST') return methodNotAllowed('POST');
    const r = await checkoutCart(env.DB, await request.json().catch(() => null));
    return r ? Response.json(r) : Response.json({ error: 'items: 1–60 of {ean, qty 1–99}; maxStores 1–7; source demo|open_prices' }, { status: 400 });
  }
  if (path === '/api/search') return request.method === 'GET' ? handleSearch(request, env, liveDeps(), waitUntil) : methodNotAllowed('GET');
  if (path === '/api/hunt') return request.method === 'POST' ? handleHunt(request, env, liveDeps(), waitUntil) : methodNotAllowed('POST');
  if (path === '/api/details') return request.method === 'GET' ? handleDetails(request, liveDeps()) : methodNotAllowed('GET');
  if (path === '/api/live') return request.method === 'GET' ? json(liveStatus(env, request, liveDeps())) : methodNotAllowed('GET');
  return json({ error: `No existe ${path}.` }, 404);
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
