/**
 * Mock API for `npm run dev:mock` (MOCK=1): serves /api/search, /api/hunt,
 * /api/details and /api/live from sample data, streaming NDJSON with per-source
 * delays so the progressive UI can be seen and screenshotted.
 *
 * Live chains answer `locked` unless the request carries `x-live-key` equal to
 * the mock key (env MOCK_KEY, default "cambia-esto").
 *
 * It follows the Worker's contract (src/live/*): every hunt answers all 8 chains (the ones
 * left out of `chains` say 'unavailable'), demo mode (`?demo=1` on search, `demo: true` on
 * hunt) reads demo prices INSTEAD of Open Prices, never mixed, and `qty` feeds the pick.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { CHAIN_IDS, type ChainId, type HuntEvent, type HuntRequest, type LiveStatus, type Offer, type Product, type SearchEvent, type SearchSource } from '../../src/shared/types';
import { CHAINS, chainList } from '../../src/shared/chains';
import { pickBest, rankCandidates } from '../../src/shared/equiv';
import { CATALOGUE, hasOpenPrices, isLiveChain, offerAt, rand, searchCatalogue, type MockProduct } from './data';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const delay = (seed: string) => 300 + Math.round(rand(seed + Date.now().toString().slice(0, -4)) * 1500);

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c: Buffer) => (data += c.toString('utf8')));
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function toProduct(p: MockProduct, offers: Offer[]): Product {
  return { key: `ean:${p.ean}`, name: p.name, brand: p.brand, sizeText: p.sizeText, ean: p.ean, image: p.image, offers };
}

/** Writes events as NDJSON at their own times; stops when the client goes away. */
async function stream<T>(req: IncomingMessage, res: ServerResponse, jobs: Array<{ at: number; event: () => T }>, done: (ms: number) => T) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.flushHeaders?.();
  let closed = false;
  req.on('close', () => (closed = true));
  const t0 = Date.now();
  for (const job of [...jobs].sort((a, b) => a.at - b.at)) {
    const wait = job.at - (Date.now() - t0);
    if (wait > 0) await sleep(wait);
    if (closed) return;
    res.write(JSON.stringify(job.event()) + '\n');
  }
  if (!closed) res.end(JSON.stringify(done(Date.now() - t0)) + '\n');
}

/** Products whose Supercor answer already timed out once (the retry then answers). */
const timedOut = new Set<string>();

const LOCKED_REASON = 'La búsqueda en vivo necesita tu clave. Añádela en Ajustes.';

function handleSearch(req: IncomingMessage, res: ServerResponse, url: URL, keyOk: boolean) {
  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 2 || q.length > 80) return json(res, 400, { error: 'La búsqueda debe tener entre 2 y 80 caracteres.' });
  const demo = url.searchParams.get('demo') === '1';
  const found = searchCatalogue(q);
  const now = new Date();
  const jobs: Array<{ at: number; event: () => SearchEvent }> = [];
  const add = (source: SearchSource, at: number, make: () => Omit<Extract<SearchEvent, { type: 'source' }>, 'type' | 'source' | 'ms'>) =>
    jobs.push({ at, event: () => ({ type: 'source', source, ms: at, ...make() }) });

  add('catalogo', delay(q + 'cat'), () => {
    const products = found
      .map((p) => toProduct(p, CHAIN_IDS.filter((c) => !isLiveChain(c) && (demo || hasOpenPrices(p, c)))
        .map((c) => offerAt(p, c, demo ? 'demo' : 'open_prices', now)).filter((o): o is Offer => !!o)))
      .filter((p) => p.offers.length);
    return { status: products.length ? 'ok' : 'none', products };
  });
  add('openfoodfacts', delay(q + 'off'), () => {
    const products = found.slice(0, 12).map((p) => toProduct(p, []));
    return { status: products.length ? 'ok' : 'none', products };
  });
  for (const chain of CHAIN_IDS.filter(isLiveChain)) {
    add(chain, delay(q + chain), () => {
      if (!keyOk) return { status: 'locked', products: [], reason: LOCKED_REASON };
      if (chain === 'ahorramas' && rand(q) > 0.8) return { status: 'blocked', products: [], reason: 'Ahorramas ha rechazado la consulta (403). Lo reintentaremos más tarde.' };
      const products = found.map((p) => offerAt(p, chain, 'live', now)).filter((o): o is Offer => !!o)
        .map((o) => toProduct(CATALOGUE.find((p) => p.ean === o.ean)!, [o]));
      return { status: products.length ? 'ok' : 'none', products };
    });
  }
  return stream(req, res, jobs, (ms): SearchEvent => ({ type: 'done', ms }));
}

async function handleHunt(req: IncomingMessage, res: ServerResponse, keyOk: boolean) {
  let body: HuntRequest;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: 'El cuerpo debe ser JSON: { product: { name, brand, sizeText, ean }, mode: "exact" | "equivalent", chains? }' });
  }
  const p = body?.product;
  if (!p || typeof p.name !== 'string' || p.name.trim().length < 2 || (body.mode !== 'exact' && body.mode !== 'equivalent')) {
    return json(res, 400, { error: 'Se acepta { product: { name (2-120), brand, sizeText, ean }, mode: "exact" | "equivalent", chains?: ChainId[] }' });
  }
  const asked: ChainId[] = Array.isArray(body.chains) && body.chains.length ? body.chains.filter((c) => CHAIN_IDS.includes(c)) : [...CHAIN_IDS];
  const qty = typeof body.qty === 'number' && body.qty >= 1 && body.qty <= 99 ? Math.round(body.qty) : 1;
  const now = new Date();
  // Like the Worker, all 8 chains answer.
  const jobs = CHAIN_IDS.map((chain) => {
    const at = asked.includes(chain) ? delay(p.name + chain) : 40;
    return {
      at,
      event: (): HuntEvent => {
        const base = { type: 'chain' as const, chain, ms: at };
        if (!asked.includes(chain)) return { ...base, status: 'unavailable', candidates: [], pick: null, reason: 'No está entre los supers elegidos para esta búsqueda.' };
        if (isLiveChain(chain) && !keyOk) return { ...base, status: 'locked', candidates: [], pick: null, reason: LOCKED_REASON };
        // Supercor times out the first time for some products, so "Reintentar" can be tried.
        if (chain === 'supercor' && rand(p.name) > 0.75 && !timedOut.has(p.name)) {
          timedOut.add(p.name);
          return { ...base, status: 'unavailable', candidates: [], pick: null, reason: 'Open Prices no ha respondido a tiempo. Vuelve a intentarlo en un rato.' };
        }
        const offers: Offer[] = [];
        for (const prod of CATALOGUE) {
          if (isLiveChain(chain)) {
            const o = offerAt(prod, chain, 'live', now);
            if (o) offers.push(o);
          } else if (body.demo) {
            const o = offerAt(prod, chain, 'demo', now);
            if (o) offers.push(o);
          } else if (hasOpenPrices(prod, chain)) {
            const o = offerAt(prod, chain, 'open_prices', now);
            if (o) offers.push(o);
          }
        }
        const candidates = rankCandidates(p, offers, body.mode).filter((c) => c.score >= 0.3);
        const pick = pickBest(candidates, body.mode, p, qty);
        const reason = isLiveChain(chain) ? undefined : CHAINS[chain].reason;
        return { ...base, status: pick ? 'ok' : 'none', candidates, pick, ...(reason ? { reason } : {}) };
      },
    };
  });
  return stream(req, res, jobs, (ms): HuntEvent => ({ type: 'done', ms }));
}

export function mockApi(opts: { key: string }): Plugin {
  return {
    name: 'cesta-mock-api',
    configureServer(server) {
      server.config.logger.info(`  mock API on: live key is "${opts.key.replace(/./g, '*')}" (env MOCK_KEY)`);
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://mock.local');
        if (!url.pathname.startsWith('/api/')) return next();
        const keyOk = req.headers['x-live-key'] === opts.key;
        try {
          if (url.pathname === '/api/search' && req.method === 'GET') return await handleSearch(req, res, url, keyOk);
          if (url.pathname === '/api/hunt' && req.method === 'POST') return await handleHunt(req, res, keyOk);
          if (url.pathname === '/api/details') {
            const ean = url.searchParams.get('ean') ?? '';
            if (!/^\d{8,14}$/.test(ean)) return json(res, 400, { error: 'ean debe tener entre 8 y 14 dígitos.' });
            await sleep(450);
            const p = CATALOGUE.find((x) => x.ean === ean);
            return json(res, 200, { details: p ? p.details : null });
          }
          if (url.pathname === '/api/live') {
            await sleep(350);
            const access = keyOk ? 'ok' : req.headers['x-live-key'] ? 'wrong' : 'missing';
            const body: LiveStatus = { live: keyOk, access, chains: chainList().map(({ id, name, mode, reason }) => ({ id, name, mode, ...(reason ? { reason } : {}) })) };
            return json(res, 200, body);
          }
          return json(res, 404, { error: 'Ruta no encontrada en la API de prueba.' });
        } catch (e) {
          return json(res, 500, { error: `Error en la API de prueba: ${(e as Error).message}` });
        }
      });
    },
  };
}
