/**
 * The web app's side of the API (web/src/lib/api.ts and web/src/lib/ndjson.ts) run against
 * the Worker's own handlers, so the two sides cannot drift apart: the live-key header it
 * sends unlocks live search, the hunt body it builds is always accepted, demo mode reaches
 * the catalogue, and its NDJSON reader reads the Worker's streams one event at a time.
 */
import { describe, expect, it } from 'vitest';
import { LIVE_KEY_HEADER as WORKER_HEADER, liveAccess } from '../src/live/auth';
import type { LiveDeps } from '../src/live/common';
import { handleDetails, liveStatus } from '../src/live/details';
import { handleHunt, parseHunt } from '../src/live/hunt';
import { handleSearch, searchQuery } from '../src/live/search';
import { CHAINS } from '../src/shared/chains';
import { CHAIN_IDS, type ChainId, type HuntEvent, type LiveStatus, type SearchEvent } from '../src/shared/types';
import { HostSpacer, makePoliteFetch } from '../src/sources/live/http';
import { LIVE_KEY_HEADER, detailsUrl, huntBody, isEan, liveHeaders, searchUrl } from '../web/src/lib/api';
import { readNdjson } from '../web/src/lib/ndjson';

const KEY = 'clave-de-prueba';
const noNetwork = (async () => {
  throw new Error('no network in tests');
}) as typeof fetch;

function deps(): LiveDeps {
  return {
    adapters: {},
    off: {},
    fetchFor: (namespace) => makePoliteFetch({ doFetch: noNetwork, namespace, spacer: new HostSpacer({ spacingMs: 0 }) }),
    now: () => new Date('2026-11-15T12:00:00Z'),
    deadlineMs: 1000,
  };
}

/** A D1 stand-in that records the bound values of every query and finds nothing. */
function fakeDb() {
  const values: unknown[][] = [];
  const db = {
    prepare: () => ({
      bind: (...v: unknown[]) => {
        values.push(v);
        return { all: async () => ({ results: [] }) };
      },
    }),
  } as unknown as D1Database;
  return { db, values };
}

/** Reads a Worker response the way the web app does. */
async function read<T>(res: Response | Promise<Response>): Promise<T[]> {
  const r = await res;
  expect(r.ok).toBe(true);
  const out: T[] = [];
  await readNdjson<T>(r.body!, (v) => out.push(v), (bad) => {
    throw new Error(`bad NDJSON line: ${bad}`);
  });
  return out;
}

describe('web app <-> Worker contract', () => {
  it('sends the live key in the header the Worker reads, and nothing without a key', () => {
    expect(LIVE_KEY_HEADER).toBe(WORKER_HEADER);
    const req = (key: string) => new Request('https://x.test/api/live', { headers: liveHeaders(key) });
    expect(liveAccess({ LIVE_KEY: KEY }, req(KEY))).toBe('ok');
    expect(liveAccess({ LIVE_KEY: KEY }, req(` ${KEY} `))).toBe('ok');
    expect(liveAccess({ LIVE_KEY: KEY }, req(''))).toBe('missing');
    expect(liveAccess({ LIVE_KEY: KEY }, req('otra'))).toBe('wrong');
    expect(liveHeaders('')).toEqual({});
    const status: LiveStatus = liveStatus({ LIVE_KEY: KEY }, req(KEY), deps());
    expect(status).toMatchObject({ live: true, access: 'ok' });
    expect(status.chains.map((c) => c.id)).toEqual([...CHAIN_IDS]);
  });

  it('builds hunt bodies the Worker always accepts, even from long Open Food Facts data', () => {
    const chains: ChainId[] = ['mercadona', 'aldi'];
    const cases = [
      { product: { name: 'Leche semidesnatada', brand: 'Pascual', sizeText: '1 L', ean: '8410128796228' }, mode: 'exact' as const, qty: 2 },
      { product: { name: `Galletas ${'muy '.repeat(60)}ricas`, brand: 'Marca, '.repeat(20), sizeText: `${'6 x 1 l '.repeat(8)}`, ean: ' 0123 ' }, mode: 'equivalent' as const, qty: 0 },
      { product: { name: '  Yogur   natural ', brand: '', sizeText: null, ean: 'abc12345678' }, mode: 'exact' as const, qty: 150 },
      { product: { name: 'Huevos', brand: null, sizeText: 'docena', ean: ' 12345678 ' }, mode: 'equivalent' as const, qty: 2.6 },
    ];
    for (const item of cases) {
      for (const demo of [false, true]) {
        const body = huntBody(item, { chains, demo });
        const parsed = parseHunt(JSON.parse(JSON.stringify(body)));
        expect(parsed, JSON.stringify(body)).toMatchObject({ ok: true });
        if (!parsed.ok) continue;
        expect(parsed.value.demo).toBe(demo);
        expect(parsed.value.chains).toEqual(chains);
        expect(parsed.value.qty).toBe(body.qty);
        expect(parsed.value.mode).toBe(item.mode);
      }
    }
    expect(huntBody(cases[1]!, { chains, demo: false }).qty).toBe(1);
    expect(huntBody(cases[2]!, { chains, demo: false })).toMatchObject({ qty: 99, product: { name: 'Yogur natural', brand: null, ean: null } });
    expect(huntBody(cases[3]!, { chains, demo: false })).toMatchObject({ qty: 3, product: { ean: '12345678' } });
  });

  it("search: the web app's URL reaches the catalogue in the right mode, and every source it waits for answers", async () => {
    for (const demo of [false, true]) {
      const { db, values } = fakeDb();
      const url = new URL(searchUrl('  leche   entera ', demo), 'https://x.test');
      expect(searchQuery(url.searchParams.get('q'))).toBe('leche entera');
      const list = await read<SearchEvent>(handleSearch(new Request(url, { headers: liveHeaders('') }), { DB: db, LIVE_KEY: KEY }, deps()));
      expect(values[0]).toContain(demo ? 'demo' : 'open_prices');
      expect(values[0]).not.toContain(demo ? 'open_prices' : 'demo');
      // The web app shows a pending pill for the catalogue, Open Food Facts and each chain marked live.
      const expected = ['catalogo', 'openfoodfacts', ...Object.values(CHAINS).filter((c) => c.mode === 'live').map((c) => c.id)];
      const answered = list.flatMap((e) => (e.type === 'source' ? [e.source] : []));
      expect([...answered].sort()).toEqual([...expected].sort());
      expect(list.at(-1)).toMatchObject({ type: 'done' });
    }
  });

  it('hunt: the stream the web app reads has all 8 chains (the ones left out unavailable), then done', async () => {
    const chains: ChainId[] = ['mercadona', 'aldi', 'lidl'];
    const body = huntBody({ product: { name: 'Leche entera', brand: 'Pascual', sizeText: '1 L', ean: null }, mode: 'exact', qty: 1 }, { chains, demo: true });
    const request = new Request('https://x.test/api/hunt', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...liveHeaders(KEY) },
      body: JSON.stringify(body),
    });
    const { db, values } = fakeDb();
    const list = await read<HuntEvent>(handleHunt(request, { DB: db, LIVE_KEY: KEY }, deps()));
    const answers = list.filter((e): e is Extract<HuntEvent, { type: 'chain' }> => e.type === 'chain');
    expect(answers.map((e) => e.chain).sort()).toEqual([...CHAIN_IDS].sort());
    for (const e of answers) {
      if (!chains.includes(e.chain)) expect(e).toMatchObject({ status: 'unavailable', candidates: [], pick: null });
    }
    expect(values.every((v) => v.includes('demo') && !v.includes('open_prices'))).toBe(true);
    expect(list.at(-1)).toMatchObject({ type: 'done' });
  });

  it('details: only EANs the Worker accepts are asked for, and the answer has the shape the app reads', async () => {
    expect(isEan('8410128796228')).toBe(true);
    expect(isEan('1234567')).toBe(false);
    expect(isEan('84101287962a8')).toBe(false);
    const res = await handleDetails(new Request(new URL(detailsUrl('8410128796228'), 'https://x.test')), deps());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ details: null });
    const bad = await handleDetails(new Request(new URL(detailsUrl('1234567'), 'https://x.test')), deps());
    expect(bad.status).toBe(400);
  });
});
