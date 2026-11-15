import { describe, expect, it, vi } from 'vitest';
import worker, { type Env } from '../src/index';
import type { LiveDeps } from '../src/live/common';
import { handleDetails } from '../src/live/details';
import type { CatalogueRow } from '../src/live/fallback';
import { handleHunt, huntQuery, parseHunt, stripSize } from '../src/live/hunt';
import { parseNdjson } from '../src/live/ndjson';
import { handleSearch } from '../src/live/search';
import { CHAINS } from '../src/shared/chains';
import type { ChainId, HuntEvent, Offer, Product, SearchEvent } from '../src/shared/types';
import { CACHE_HEADER, HostSpacer, makePoliteFetch } from '../src/sources/live/http';
import { BlockedError, type AdapterCtx, type ChainAdapter } from '../src/sources/live/types';

const NOW = new Date('2026-11-15T12:00:00Z');
const KEY = 'clave-de-prueba';
const noNetwork = (async () => {
  throw new Error('no network in tests');
}) as typeof fetch;

/** A D1 stand-in: records every query and answers the same rows (the code filters by chain). */
function fakeDb(rows: CatalogueRow[] = []) {
  const calls: Array<{ sql: string; values: unknown[] }> = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => {
        calls.push({ sql, values });
        return { all: async () => ({ results: rows }) };
      },
    }),
  } as unknown as D1Database;
  return { db, calls };
}

function deps(over: Partial<LiveDeps> = {}): LiveDeps {
  return {
    adapters: {},
    off: {},
    fetchFor: (namespace) => makePoliteFetch({ doFetch: noNetwork, namespace, spacer: new HostSpacer({ spacingMs: 0 }) }),
    now: () => NOW,
    deadlineMs: 1000,
    ...over,
  };
}

function fakeAdapter(chain: ChainId, impl: (q: string, ctx: AdapterCtx) => Promise<Offer[]>) {
  const queries: string[] = [];
  const adapter: ChainAdapter = {
    chain,
    search: async (q, ctx) => {
      queries.push(q);
      return impl(q, ctx);
    },
  };
  return { adapter, queries };
}

const offer = (chain: ChainId, over: Partial<Offer> = {}): Offer => ({
  chain, id: `${chain}-1`, name: 'Leche semidesnatada Pascual', brand: 'Pascual', ean: '8000000000001', sizeText: '1 L',
  priceCents: 99, unitPriceCents: null, unit: null, image: `https://img.test/${chain}.jpg`, url: null, promo: null,
  source: 'live', observedOn: '2026-11-15', ...over,
});

const ROWS: CatalogueRow[] = [
  { ean: '8000000000001', name: 'Leche semidesnatada', brand: 'Pascual', size: '1 l', chain: 'Carrefour', source: 'open_prices', price_cents: 120, observed_on: '2026-08-01' },
  { ean: '8000000000001', name: 'Leche semidesnatada', brand: 'Pascual', size: '1 l', chain: 'Alcampo', source: 'open_prices', price_cents: 115, observed_on: '2026-11-01' },
  { ean: '8000000000002', name: 'Leche semidesnatada', brand: 'Hacendado', size: '1 l', chain: 'Mercadona', source: 'open_prices', price_cents: 89, observed_on: '2026-11-10' },
];

const later = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const searchReq = (q: string, key?: string) => new Request(`https://x.test/api/search?q=${encodeURIComponent(q)}`, { headers: key ? { 'x-live-key': key } : {} });
const huntReq = (body: unknown, key?: string) => new Request('https://x.test/api/hunt', {
  method: 'POST',
  body: typeof body === 'string' ? body : JSON.stringify(body),
  headers: { 'content-type': 'application/json', ...(key ? { 'x-live-key': key } : {}) },
});
const WANTED = { name: 'Leche semidesnatada 1 L', brand: 'Pascual', sizeText: '1 L', ean: '8000000000001' };

async function events<T>(res: Response | Promise<Response>): Promise<T[]> {
  const r = await res;
  expect(r.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
  return parseNdjson<T>(await r.text());
}

describe('GET /api/search', () => {
  it('answers 400 with what it accepts for a query under 2 or over 80 characters', async () => {
    for (const q of ['', ' a ', 'x'.repeat(81)]) {
      const res = await worker.fetch(searchReq(q), { DB: fakeDb().db } as Env);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain('entre 2 y 80');
    }
    const post = await worker.fetch(new Request('https://x.test/api/search?q=leche', { method: 'POST' }), {} as Env);
    expect(post.status).toBe(405);
  });

  it('streams the catalogue and done through the Worker; without the key the live chains stay locked and are never called', async () => {
    const { db, calls } = fakeDb(ROWS);
    const asked: string[] = [];
    vi.stubGlobal('fetch', (async (input: RequestInfo | URL) => {
      asked.push(String(input instanceof Request ? input.url : input));
      return new Response('{}', { status: 503 });
    }) as typeof fetch);
    try {
      const list = await events<SearchEvent>(worker.fetch(searchReq('leche'), { DB: db } as Env));
      const sources = list.filter((e): e is Extract<SearchEvent, { type: 'source' }> => e.type === 'source');
      const liveChains = Object.values(CHAINS).filter((c) => c.mode === 'live').map((c) => c.id);
      expect(sources.map((e) => e.source).sort()).toEqual([...liveChains, 'catalogo', 'openfoodfacts'].sort());
      for (const e of sources.filter((x) => liveChains.includes(x.source as ChainId))) {
        expect(e).toMatchObject({ status: 'locked', products: [] });
        expect(e.reason).toBeTruthy();
      }
      // Open Food Facts needs no key; here it is down, which is reported, not fatal.
      expect(sources.find((e) => e.source === 'openfoodfacts')!.status).not.toBe('ok');
      expect(asked.every((u) => u.startsWith('https://world.openfoodfacts.org/'))).toBe(true);
      expect(list.at(-1)!.type).toBe('done');
      const cat = sources.find((e) => e.source === 'catalogo')!;
      expect(cat.status).toBe('ok');
      expect(cat.products.map((p) => p.ean)).toEqual(['8000000000002', '8000000000001']);
      expect(calls[0]!.values).toContain('open_prices');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('locks live chains without the key and never calls them', async () => {
    const alcampo = fakeAdapter('alcampo', async () => [offer('alcampo')]);
    const aldi = fakeAdapter('aldi', async () => [offer('aldi')]);
    const d = deps({ adapters: { alcampo: alcampo.adapter, aldi: aldi.adapter } });
    for (const key of [undefined, 'otra']) {
      const list = await events<SearchEvent>(handleSearch(searchReq('leche', key), { DB: fakeDb().db, LIVE_KEY: KEY }, d));
      const locked = list.filter((e) => e.type === 'source' && e.status === 'locked') as Array<Extract<SearchEvent, { type: 'source' }>>;
      expect(locked.map((e) => e.source).sort()).toEqual(['alcampo', 'aldi']);
      for (const e of locked) expect(e.reason).toBeTruthy();
      expect(list.at(-1)!.type).toBe('done');
    }
    expect(alcampo.queries).toEqual([]);
    expect(aldi.queries).toEqual([]);
  });

  it('with the key, every source answers on its own: ok, error, blocked; the stream still ends', async () => {
    const alcampo = fakeAdapter('alcampo', async () => [
      offer('alcampo', { id: 'a1', priceCents: 109 }),
      offer('alcampo', { id: 'a2', priceCents: 99 }),
      offer('alcampo', { id: 'a3', name: 'Leche entera', ean: null, brand: 'Alcampo' }),
    ]);
    const aldi = fakeAdapter('aldi', async () => {
      throw new Error('aldi: HTTP 500');
    });
    const ahorramas = fakeAdapter('ahorramas', async () => {
      throw new BlockedError(403, 'ahorramas: blocked (403)');
    });
    const offProducts: Product[] = [
      { key: 'ean:8000000000001', name: 'Leche', brand: 'Pascual', sizeText: '1 l', ean: '8000000000001', image: 'https://off.test/1.jpg', offers: [] },
      { key: 'ean:8000000000001', name: 'Leche (repetida)', brand: 'Pascual', sizeText: '1 l', ean: '8000000000001', image: null, offers: [] },
    ];
    const d = deps({
      adapters: { alcampo: alcampo.adapter, aldi: aldi.adapter, ahorramas: ahorramas.adapter },
      off: { search: async () => offProducts },
    });
    const list = await events<SearchEvent>(handleSearch(searchReq('leche', KEY), { DB: fakeDb(ROWS).db, LIVE_KEY: KEY }, d));
    const by = new Map(list.filter((e) => e.type === 'source').map((e) => [(e as Extract<SearchEvent, { type: 'source' }>).source, e as Extract<SearchEvent, { type: 'source' }>]));
    expect([...by.keys()].sort()).toEqual(['ahorramas', 'alcampo', 'aldi', 'catalogo', 'openfoodfacts']);
    expect(list.at(-1)).toMatchObject({ type: 'done' });
    // Same EAN at one chain: one card with both offers, cheapest first.
    const a = by.get('alcampo')!;
    expect(a.status).toBe('ok');
    expect(a.products).toHaveLength(2);
    expect(a.products[0]!.offers.map((o) => o.id)).toEqual(['a2', 'a1']);
    expect(a.products[0]!.offers.every((o) => o.source === 'live' && o.chain === 'alcampo')).toBe(true);
    expect(by.get('aldi')).toMatchObject({ status: 'error', products: [] });
    expect(by.get('aldi')!.reason).toContain('Aldi');
    expect(by.get('ahorramas')).toMatchObject({ status: 'blocked', products: [] });
    expect(by.get('ahorramas')!.reason).toContain('403');
    expect(by.get('openfoodfacts')!.products).toHaveLength(1);
    expect(by.get('catalogo')!.status).toBe('ok');
    expect(alcampo.queries).toEqual(['leche']);
  });

  it('sends each source as it finishes, slow ones last', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const alcampo = fakeAdapter('alcampo', async () => {
      await gate;
      return [offer('alcampo')];
    });
    const aldi = fakeAdapter('aldi', async () => later(5, [offer('aldi')]));
    const d = deps({ adapters: { alcampo: alcampo.adapter, aldi: aldi.adapter } });
    const res = handleSearch(searchReq('leche', KEY), { DB: fakeDb(ROWS).db, LIVE_KEY: KEY }, d);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    while (!(text.includes('"source":"aldi"') && text.includes('"source":"catalogo"'))) {
      const { value, done } = await reader.read();
      if (done) throw new Error('stream ended early');
      text += decoder.decode(value, { stream: true });
    }
    expect(text).not.toContain('"source":"alcampo"');
    release();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
    }
    const order = parseNdjson<SearchEvent>(text).map((e) => (e.type === 'source' ? e.source : e.type));
    expect(order.slice(-2)).toEqual(['alcampo', 'done']);
  });

  it('a chain that never answers ends as an error at the deadline', async () => {
    const alcampo = fakeAdapter('alcampo', () => new Promise<Offer[]>(() => undefined));
    const d = deps({ adapters: { alcampo: alcampo.adapter }, deadlineMs: 20 });
    const list = await events<SearchEvent>(handleSearch(searchReq('leche', KEY), { DB: fakeDb().db, LIVE_KEY: KEY }, d));
    expect(list.find((e) => e.type === 'source' && e.source === 'alcampo')).toMatchObject({ status: 'error' });
    expect(list.at(-1)!.type).toBe('done');
  });

  it('never searches live a chain marked fallback, even with an adapter', async () => {
    const mercadona = fakeAdapter('mercadona', async () => [offer('mercadona')]);
    const list = await events<SearchEvent>(handleSearch(searchReq('leche', KEY), { DB: fakeDb().db, LIVE_KEY: KEY }, deps({ adapters: { mercadona: mercadona.adapter } })));
    expect(mercadona.queries).toEqual([]);
    expect(list.some((e) => e.type === 'source' && e.source === 'mercadona')).toBe(false);
  });

  it('reads demo prices only when asked, and says when there is no catalogue', async () => {
    const { db, calls } = fakeDb();
    await events(handleSearch(new Request('https://x.test/api/search?q=leche&demo=1'), { DB: db }, deps()));
    expect(calls[0]!.values).toContain('demo');
    expect(calls[0]!.values).not.toContain('open_prices');
    const list = await events<SearchEvent>(handleSearch(searchReq('leche'), {}, deps()));
    expect(list.find((e) => e.type === 'source' && e.source === 'catalogo')).toMatchObject({ status: 'unavailable' });
  });
});

describe('POST /api/hunt: input', () => {
  it('accepts a product, a mode, chains, demo and qty', () => {
    expect(parseHunt({ product: { name: '  Leche  semidesnatada ', brand: 'Pascual', sizeText: '1 L', ean: '8000000000001' }, mode: 'exact' }))
      .toEqual({ ok: true, value: { product: { name: 'Leche semidesnatada', brand: 'Pascual', sizeText: '1 L', ean: '8000000000001' }, mode: 'exact', chains: null, demo: false, qty: 1 } });
    const r = parseHunt({ product: { name: 'Leche' }, mode: 'equivalent', chains: ['aldi', 'aldi', 'bm'], demo: true, qty: 3 });
    expect(r).toEqual({ ok: true, value: { product: { name: 'Leche', brand: null, sizeText: null, ean: null }, mode: 'equivalent', chains: ['aldi', 'bm'], demo: true, qty: 3 } });
  });

  it('refuses what it does not accept, saying what it does', () => {
    const bad = [
      null, [], { mode: 'exact' },
      { product: { name: 'L' }, mode: 'exact' },
      { product: { name: 'x'.repeat(121) }, mode: 'exact' },
      { product: { name: 'Leche', ean: '12ab' }, mode: 'exact' },
      { product: { name: 'Leche', brand: 7 }, mode: 'exact' },
      { product: { name: 'Leche' }, mode: 'cheap' },
      { product: { name: 'Leche' }, mode: 'exact', chains: ['dia'] },
      { product: { name: 'Leche' }, mode: 'exact', chains: [] },
      { product: { name: 'Leche' }, mode: 'exact', demo: 'yes' },
      { product: { name: 'Leche' }, mode: 'exact', qty: 0 },
      { product: { name: 'Leche' }, mode: 'exact', qty: 100 },
    ];
    for (const b of bad) {
      const r = parseHunt(b);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain('mode');
    }
  });

  it('answers 400, 405 and 413 through the Worker', async () => {
    const env = { DB: fakeDb().db } as Env;
    const r1 = await worker.fetch(huntReq('no es json'), env);
    expect(r1.status).toBe(400);
    expect(((await r1.json()) as { error: string }).error).toContain('JSON');
    const r2 = await worker.fetch(huntReq({ product: { name: 'L' }, mode: 'exact' }), env);
    expect(r2.status).toBe(400);
    expect(((await r2.json()) as { error: string }).error).toContain('product.name');
    expect((await worker.fetch(new Request('https://x.test/api/hunt'), env)).status).toBe(405);
    const big = await worker.fetch(huntReq({ product: { name: 'Leche', brand: 'x'.repeat(9000) }, mode: 'exact' }), env);
    expect(big.status).toBe(413);
  });

  it('asks exact hunts for brand and name without the size, equivalent hunts for the generic words', () => {
    expect(stripSize('Leche entera Hacendado 6 x 1 L')).toBe('Leche entera Hacendado');
    expect(stripSize('Pack 6 x 200 ml zumo de naranja')).toBe('zumo de naranja');
    expect(stripSize('Aceite de oliva virgen extra 1,5 l')).toBe('Aceite de oliva virgen extra');
    expect(stripSize('Huevos 12 ud')).toBe('Huevos');
    expect(huntQuery({ name: 'Leche semidesnatada 1 L', brand: 'Pascual', sizeText: '1 L', ean: null }, 'exact')).toBe('Pascual Leche semidesnatada');
    expect(huntQuery({ name: 'Leche entera Hacendado 6 x 1 L', brand: 'Hacendado', sizeText: null, ean: null }, 'exact')).toBe('Leche entera Hacendado');
    expect(huntQuery({ name: 'Leche entera Hacendado 6 x 1 L', brand: 'Hacendado', sizeText: null, ean: null }, 'equivalent')).toBe('Leche entera');
    expect(huntQuery({ name: 'Lasaña Fácil 200 g', brand: 'Gallina Blanca', sizeText: null, ean: null }, 'equivalent')).toBe('Lasaña Fácil');
    expect(huntQuery({ name: 'Leche sin lactosa', brand: null, sizeText: null, ean: null }, 'equivalent')).toBe('Leche sin lactosa');
    expect(huntQuery({ name: 'Zumo de naranja Don Sim\u00f3n', brand: 'Don Sim\u00f3n', sizeText: null, ean: null }, 'equivalent')).toBe('Zumo de naranja');
    expect(huntQuery({ name: 'Leche entera Hacendado', brand: null, sizeText: null, ean: null }, 'equivalent')).toBe('Leche entera');
    expect(huntQuery({ name: 'T\u00e9 verde', brand: null, sizeText: null, ean: null }, 'equivalent')).toBe('T\u00e9 verde');
    expect(huntQuery({ name: '500 g', brand: null, sizeText: null, ean: null }, 'equivalent')).toBe('500 g');
  });
});

type ChainEvent = Extract<HuntEvent, { type: 'chain' }>;
const byChain = (list: HuntEvent[]) => new Map(list.filter((e): e is ChainEvent => e.type === 'chain').map((e) => [e.chain, e]));

describe('POST /api/hunt: one answer per chain', () => {
  it('without the key: all 8 chains answer, live ones locked and never called, fallback ones from D1', async () => {
    const alcampo = fakeAdapter('alcampo', async () => [offer('alcampo')]);
    const aldi = fakeAdapter('aldi', async () => [offer('aldi')]);
    const ahorramas = fakeAdapter('ahorramas', async () => [offer('ahorramas')]);
    const d = deps({ adapters: { alcampo: alcampo.adapter, aldi: aldi.adapter, ahorramas: ahorramas.adapter } });
    const list = await events<HuntEvent>(handleHunt(huntReq({ product: WANTED, mode: 'exact' }), { DB: fakeDb(ROWS).db, LIVE_KEY: KEY }, d));
    expect(list).toHaveLength(9);
    expect(list.at(-1)!.type).toBe('done');
    const by = byChain(list);
    expect([...by.keys()].sort()).toEqual(['ahorramas', 'alcampo', 'aldi', 'bm', 'carrefour', 'lidl', 'mercadona', 'supercor']);
    for (const id of ['alcampo', 'aldi', 'ahorramas'] as const) expect(by.get(id)!.status).toBe('locked');
    expect(alcampo.queries.length + aldi.queries.length + ahorramas.queries.length).toBe(0);
    // A locked chain still shows the catalogue's price for it, and says so.
    expect(by.get('alcampo')!.pick).toMatchObject({ chain: 'alcampo', priceCents: 115, source: 'open_prices', kind: 'exact' });
    expect(by.get('alcampo')!.reason).toContain('catálogo');
    expect(by.get('aldi')!.candidates).toEqual([]);
    // Fallback chains answer with their reason, found or not.
    expect(by.get('carrefour')).toMatchObject({ status: 'ok', reason: CHAINS.carrefour.reason });
    expect(by.get('carrefour')!.pick).toMatchObject({ priceCents: 120, observedOn: '2026-08-01', kind: 'exact', score: 1 });
    expect(by.get('mercadona')).toMatchObject({ status: 'none', pick: null, reason: CHAINS.mercadona.reason });
    for (const id of ['lidl', 'supercor', 'bm'] as const) expect(by.get(id)).toMatchObject({ status: 'none', reason: CHAINS[id].reason });
  });

  it('with the key, live chains are asked once each; a throwing one is an error, a refusing one blocked', async () => {
    const alcampo = fakeAdapter('alcampo', async () => [offer('alcampo', { priceCents: 105 }), offer('alcampo', { id: 'x', name: 'Yogur', ean: null, brand: 'Danone', sizeText: '4 x 125 g' })]);
    const aldi = fakeAdapter('aldi', async () => {
      throw new Error('aldi: page without product state');
    });
    const ahorramas = fakeAdapter('ahorramas', async () => {
      throw new BlockedError(429);
    });
    const d = deps({ adapters: { alcampo: alcampo.adapter, aldi: aldi.adapter, ahorramas: ahorramas.adapter } });
    const list = await events<HuntEvent>(handleHunt(huntReq({ product: WANTED, mode: 'exact' }, KEY), { DB: fakeDb(ROWS).db, LIVE_KEY: KEY }, d));
    expect(list).toHaveLength(9);
    expect(list.at(-1)!.type).toBe('done');
    const by = byChain(list);
    expect(alcampo.queries).toEqual(['Pascual Leche semidesnatada']);
    expect(by.get('alcampo')).toMatchObject({ status: 'ok', pick: { chain: 'alcampo', priceCents: 105, source: 'live', kind: 'exact' } });
    // Exact mode drops the weak yogurt.
    expect(by.get('alcampo')!.candidates.map((c) => c.id)).toEqual(['alcampo-1']);
    expect(by.get('aldi')).toMatchObject({ status: 'error', candidates: [], pick: null });
    expect(by.get('aldi')!.reason).toContain('page without product state');
    expect(by.get('ahorramas')).toMatchObject({ status: 'blocked', pick: null });
    expect(by.get('carrefour')!.status).toBe('ok');
  });

  it('equivalent hunts ask for the generic words and pick the cheapest acceptable offer', async () => {
    const alcampo = fakeAdapter('alcampo', async () => [
      offer('alcampo', { id: 'pascual', priceCents: 119 }),
      offer('alcampo', { id: 'blanca', name: 'Leche semidesnatada Auchan', brand: 'Auchan', ean: '3245670000001', priceCents: 79 }),
    ]);
    const d = deps({ adapters: { alcampo: alcampo.adapter } });
    const list = await events<HuntEvent>(handleHunt(huntReq({ product: WANTED, mode: 'equivalent' }, KEY), { DB: fakeDb().db, LIVE_KEY: KEY }, d));
    expect(alcampo.queries).toEqual(['Leche semidesnatada']);
    expect(byChain(list).get('alcampo')!.pick).toMatchObject({ id: 'blanca', priceCents: 79 });
  });

  it('chains left out answer unavailable; demo reads demo prices and says so', async () => {
    const { db, calls } = fakeDb([{ ...ROWS[0]!, source: 'demo' }]);
    const list = await events<HuntEvent>(handleHunt(huntReq({ product: WANTED, mode: 'exact', chains: ['carrefour', 'lidl'], demo: true }), { DB: db }, deps()));
    const by = byChain(list);
    expect(by.size).toBe(8);
    expect(by.get('carrefour')).toMatchObject({ status: 'ok', pick: { source: 'demo' } });
    expect(by.get('carrefour')!.reason).toContain('Modo demo');
    expect(by.get('lidl')!.status).toBe('none');
    for (const id of ['mercadona', 'alcampo', 'aldi', 'ahorramas', 'supercor', 'bm'] as const) expect(by.get(id)!.status).toBe('unavailable');
    expect(calls.every((c) => c.values.includes('demo') && !c.values.includes('open_prices'))).toBe(true);
    expect(calls[0]!.values).toEqual(expect.arrayContaining(['Carrefour', 'Lidl']));
    expect(calls[0]!.values).not.toContain('Mercadona');
  });

  it('without a catalogue, fallback chains say so and the stream still ends', async () => {
    const list = await events<HuntEvent>(handleHunt(huntReq({ product: WANTED, mode: 'exact' }), {}, deps()));
    expect(list).toHaveLength(9);
    expect(byChain(list).get('carrefour')!.status).toBe('unavailable');
    expect(list.at(-1)!.type).toBe('done');
  });

  it('a catalogue that fails does not break the stream', async () => {
    const db = { prepare: () => ({ bind: () => ({ all: async () => { throw new Error('D1_ERROR: boom'); } }) }) } as unknown as D1Database;
    const list = await events<HuntEvent>(handleHunt(huntReq({ product: WANTED, mode: 'exact' }), { DB: db }, deps()));
    expect(list).toHaveLength(9);
    expect(byChain(list).get('lidl')!.status).toBe('unavailable');
  });

  it('runs through the polite fetch: honest user agent, and offers from the cache are flagged', async () => {
    const store = new Map<string, Response>();
    const cache = {
      match: async (r: Request) => store.get(r.url)?.clone(),
      put: async (r: Request, res: Response) => { store.set(r.url, res.clone()); },
      delete: async (r: Request) => store.delete(r.url),
    } as unknown as Cache;
    const agents: Array<string | null> = [];
    const doFetch = (async (_: RequestInfo | URL, init?: RequestInit) => {
      agents.push(new Headers(init?.headers).get('user-agent'));
      return new Response('{"price":99}', { status: 200 });
    }) as typeof fetch;
    const seen: Array<string | null> = [];
    const alcampo = fakeAdapter('alcampo', async (_q, ctx) => {
      const res = await ctx.fetch('https://shop.test/search?q=leche', { kind: 'search' });
      seen.push(res.headers.get(CACHE_HEADER));
      return [offer('alcampo', { priceCents: ((await res.json()) as { price: number }).price })];
    });
    const spacer = new HostSpacer({ spacingMs: 0 });
    const d = deps({ adapters: { alcampo: alcampo.adapter }, fetchFor: (namespace) => makePoliteFetch({ doFetch, cache, namespace, spacer }) });
    const env = { DB: fakeDb().db, LIVE_KEY: KEY };
    const first = byChain(await events<HuntEvent>(handleHunt(huntReq({ product: WANTED, mode: 'exact' }, KEY), env, d))).get('alcampo')!;
    const second = byChain(await events<HuntEvent>(handleHunt(huntReq({ product: WANTED, mode: 'exact' }, KEY), env, d))).get('alcampo')!;
    expect(seen).toEqual(['miss', 'hit']);
    expect(agents).toHaveLength(1);
    expect(agents[0]).toContain('cesta-compra/0.2');
    expect(first.pick!.cached).toBeUndefined();
    expect(second.pick!.cached).toBe(true);
  });
});

describe('GET /api/details', () => {
  it('needs a barcode of 8 to 14 digits', async () => {
    const res = await worker.fetch(new Request('https://x.test/api/details?ean=abc'), {} as Env);
    expect(res.status).toBe(400);
  });

  it('answers null through the Worker when Open Food Facts does not know the EAN', async () => {
    vi.stubGlobal('fetch', (async () => Response.json({ code: '8410128796228', status: 0, status_verbose: 'product not found' }, { status: 404 })) as typeof fetch);
    try {
      const res = await worker.fetch(new Request('https://x.test/api/details?ean=8410128796228'), {} as Env);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ details: null });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('answers the provider details, cached 24 h; a failing provider is a 502 with a reason', async () => {
    const asked: string[] = [];
    const ok = await handleDetails(new Request('https://x.test/api/details?ean=8410128796228'), deps({
      off: { details: async (ean) => { asked.push(ean); return { nutriscore: 'b', allergens: ['soja'] }; } },
    }));
    expect(await ok.json()).toEqual({ details: { nutriscore: 'b', allergens: ['soja'] } });
    expect(ok.headers.get('cache-control')).toBe('public, max-age=86400');
    expect(asked).toEqual(['8410128796228']);
    const bad = await handleDetails(new Request('https://x.test/api/details?ean=8410128796228'), deps({
      off: { details: async () => { throw new BlockedError(429); } },
    }));
    expect(bad.status).toBe(502);
    expect(await bad.json()).toMatchObject({ details: null });
  });
});
