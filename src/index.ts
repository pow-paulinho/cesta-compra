import { fetchOpenPrices } from './sources/openprices';
import { logImport, saveOpenPrices, seedDemo, status } from './store';

export interface Env { DB: D1Database }

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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json(health());
    if (url.pathname === '/api/status') return Response.json(await status(env.DB));
    return new Response('cesta-compra: under construction', { headers: { 'content-type': 'text/plain; charset=utf-8' } });
  },
  /* Awaited, not handed to waitUntil (CC-3): waitUntil work is cancelled about 30 s
     after the handler returns, and the polite Open Prices reader takes longer. A
     scheduled handler may run for minutes while it is still awaiting. */
  async scheduled(_event: ScheduledController, env: Env): Promise<void> {
    await runImport(env);
  },
} satisfies ExportedHandler<Env>;
