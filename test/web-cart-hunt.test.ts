/**
 * The hunt queue (web/src/lib/hunt.ts) against a fake /api/hunt: retrying only the
 * chains that failed, giving back the old answers when a re-search is cancelled,
 * resuming twice without breaking the running hunt, a progress count that cannot
 * drift, and demo mode that hunts its chains again.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@shared/units', () => import('../src/shared/units'));
vi.mock('@shared/chains', () => import('../src/shared/chains'));
vi.mock('@shared/equiv', () => import('../src/shared/equiv'));
vi.mock('@shared/types', () => import('../src/shared/types'));

import type { ChainId, ChainStatus, HuntEvent, HuntRequest, OfferSource } from '../src/shared/types';
import type { CartItem } from '../web/src/lib/store';

type Answer = { status: ChainStatus; cents?: number; source?: OfferSource };

/** A fake /api/hunt: answers each asked chain after `delay` ms, as `answer` says. */
function fakeApi(answer: (chain: ChainId, call: number, body: HuntRequest) => Answer, delay = 10) {
  const calls: HuntRequest[] = [];
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as HuntRequest;
    const call = calls.push(body);
    const signal = init.signal!;
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(ctrl) {
        signal.addEventListener('abort', () => ctrl.error(new DOMException('aborted', 'AbortError')));
        for (const chain of body.chains ?? []) {
          await new Promise((r) => setTimeout(r, delay));
          if (signal.aborted) return;
          const a = answer(chain, call, body);
          const c = a.cents
            ? [{ chain, id: `${chain}-${call}`, name: body.product.name, brand: null, ean: null, sizeText: '1 L', priceCents: a.cents, unitPriceCents: null, unit: null, image: null, url: null, promo: null, source: a.source ?? 'open_prices', observedOn: '2026-11-01', score: 1, kind: 'exact' as const }]
            : [];
          const ev: HuntEvent = { type: 'chain', chain, status: a.status, candidates: c, pick: c[0] ?? null, ms: 1, ...(a.status === 'unavailable' ? { reason: 'No ha respondido a tiempo.' } : {}) };
          ctrl.enqueue(enc.encode(JSON.stringify(ev) + '\n'));
        }
        ctrl.enqueue(enc.encode(JSON.stringify({ type: 'done', ms: 1 }) + '\n'));
        ctrl.close();
      },
    });
    return new Response(stream, { status: 200 });
  });
  return calls;
}

const CHAINS: ChainId[] = ['mercadona', 'lidl', 'supercor'];

async function fresh(items: CartItem[], demo = false) {
  vi.resetModules();
  const store = await import('../web/src/lib/store');
  store.setState((s) => ({ ...s, cart: items, settings: { ...s.settings, chains: CHAINS, demo } }));
  const hunt = await import('../web/src/lib/hunt');
  return { store, hunt, get: (id: string) => store.getState().cart.find((i) => i.id === id)! };
}

function item(id: string, over: Partial<CartItem> = {}): CartItem {
  return {
    id,
    product: { key: `k:${id}`, name: `Leche ${id}`, brand: null, sizeText: '1 L', ean: null, image: null, offers: [] },
    qty: 1,
    mode: 'exact',
    hunt: { status: 'done', chains: {}, queuedAt: 0 },
    choice: {},
    addedAt: 0,
    ...over,
  };
}

const settle = () => vi.advanceTimersByTimeAsync(5000);

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('hunt queue', () => {
  it('retries only the chains that failed and keeps the other answers and choices', async () => {
    const calls = fakeApi((chain, call) => (chain === 'supercor' && call === 1 ? { status: 'unavailable' } : { status: 'ok', cents: 100 + call }));
    const { hunt, store, get } = await fresh([item('a')]);
    hunt.enqueue('a');
    await settle();
    expect(get('a').hunt.chains.supercor?.status).toBe('unavailable');
    expect(hunt.failedChains(get('a'), CHAINS)).toEqual(['supercor']);
    store.updateItem('a', (i) => ({ ...i, choice: { lidl: 'lidl-1' } }));

    expect(hunt.retryFailed('a')).toBe(1);
    await settle();
    expect(calls[1]!.chains).toEqual(['supercor']);
    const a = get('a');
    expect(a.hunt.status).toBe('done');
    expect(a.hunt.chains.supercor?.status).toBe('ok');
    expect(a.hunt.chains.lidl?.candidates[0]?.id).toBe('lidl-1');
    expect(a.choice).toEqual({ lidl: 'lidl-1' });
    expect(a.hunt.only).toBeUndefined();
  });

  it('a re-search cancelled at once (a double click) gives back the earlier answers', async () => {
    const calls = fakeApi(() => ({ status: 'ok', cents: 120 }));
    const { hunt, get } = await fresh([item('a')]);
    hunt.enqueue('a');
    await settle();
    const before = get('a').hunt.chains;
    hunt.enqueue('a');
    hunt.cancel('a');
    await settle();
    expect(get('a').hunt.status).toBe('cancelled');
    expect(get('a').hunt.chains).toEqual(before);
    expect(calls.length).toBeLessThanOrEqual(2);
  });

  it('resuming twice (StrictMode) does not break the running hunt', async () => {
    const calls = fakeApi(() => ({ status: 'ok', cents: 120 }));
    const { hunt, get } = await fresh([
      item('a', { hunt: { status: 'running', queuedAt: 1, chains: { mercadona: { status: 'ok', candidates: [], pick: null }, lidl: { status: 'pending', candidates: [], pick: null }, supercor: { status: 'pending', candidates: [], pick: null } } } }),
    ]);
    hunt.resumePending();
    hunt.resumePending();
    await settle();
    expect(calls).toHaveLength(1);
    const a = get('a');
    expect(a.hunt.status).toBe('done');
    expect(Object.values(a.hunt.chains).map((h) => h!.status)).toEqual(['ok', 'ok', 'ok']);
  });

  it('counts progress from the cart: removing a finished item does not shrink what is left', async () => {
    fakeApi(() => ({ status: 'ok', cents: 120 }), 400);
    const { hunt, store } = await fresh([item('a'), item('b'), item('c')]);
    hunt.enqueue('a');
    hunt.enqueue('b');
    hunt.enqueue('c');
    hunt.enqueue('c'); // queued twice: still one item
    await vi.advanceTimersByTimeAsync(1700);
    expect(store.getState().cart.map((i) => i.hunt.status)).toEqual(['done', 'running', 'queued']);
    hunt.forget('a');
    store.setState((s) => ({ ...s, cart: s.cart.filter((i) => i.id !== 'a') }));
    let p = progressOf(hunt);
    expect([p.done, p.total]).toEqual([1, 3]);
    expect(p.current).toBe('Leche b');
    await vi.advanceTimersByTimeAsync(3000);
    p = progressOf(hunt);
    expect([p.done, p.total, p.current, p.active]).toEqual([3, 3, null, true]);
    expect(p.last).toMatch(/^Leche c: mejor 1,20\s€ en Mercadona\.$/);
    await vi.advanceTimersByTimeAsync(2500);
    expect(progressOf(hunt).active).toBe(false);
  });

  it('switching demo mode hunts again the chains that answered from the catalogue', async () => {
    const calls = fakeApi((chain, _call, body) => (chain === 'lidl' ? { status: 'ok', cents: 150, source: 'live' } : { status: 'ok', cents: 100, source: body.demo ? 'demo' : 'open_prices' }));
    const { hunt, store, get } = await fresh([item('a')]);
    hunt.enqueue('a');
    await settle();
    store.updateSettings({ demo: true });
    await settle();
    expect(calls).toHaveLength(2);
    expect(calls[1]!.demo).toBe(true);
    expect(calls[1]!.chains).toEqual(['mercadona', 'supercor']);
    const a = get('a');
    expect(a.hunt.demo).toBe(true);
    expect(a.hunt.chains.mercadona?.candidates[0]?.source).toBe('demo');
    expect(a.hunt.chains.lidl?.candidates[0]?.source).toBe('live');
  });
});

const progressOf = (hunt: typeof import('../web/src/lib/hunt')) => hunt.huntProgress();
