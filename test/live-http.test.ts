import { describe, expect, it } from 'vitest';
import {
  BudgetError, CACHE_HEADER, HostSpacer, TimeoutError, USER_AGENT, cacheUrl, makePoliteFetch,
} from '../src/sources/live/http';

/** A Cache API stand-in keyed by URL. */
class FakeCache {
  readonly store = new Map<string, Response>();
  async match(req: Request) {
    const r = this.store.get(req.url);
    return r ? r.clone() : undefined;
  }
  async put(req: Request, res: Response) {
    this.store.set(req.url, res.clone());
  }
  async delete(req: Request) {
    return this.store.delete(req.url);
  }
}

interface Call { url: string; at: number; method: string; ua: string | null; signal: AbortSignal | null }

/** A fake clock, a sleep that advances it, and a fetch that records when it was called. */
function rig(answer: (url: string, init: RequestInit) => Response | Promise<Response> = () => new Response('ok')) {
  const clock = { t: 0 };
  const sleeps: number[] = [];
  const calls: Call[] = [];
  const spacer = new HostSpacer({ now: () => clock.t, sleep: async (ms) => { sleeps.push(ms); clock.t += ms; } });
  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const i = init ?? {};
    calls.push({ url, at: clock.t, method: i.method ?? 'GET', ua: new Headers(i.headers).get('user-agent'), signal: i.signal ?? null });
    clock.t += 100;
    return answer(url, i);
  }) as typeof fetch;
  return { clock, sleeps, calls, spacer, doFetch };
}

describe('the polite fetch', () => {
  it('sends the honest user agent, replacing any other', async () => {
    const r = rig();
    const f = makePoliteFetch({ doFetch: r.doFetch, spacer: r.spacer });
    await f('https://www.example.es/a', { headers: { 'user-agent': 'Mozilla/5.0 (pretending)' } });
    expect(r.calls[0]!.ua).toBe(USER_AGENT);
    expect(USER_AGENT).toBe('cesta-compra/0.2 (+https://github.com/pow-paulinho/cesta-compra; uso personal)');
  });

  it('spaces requests to one host by at least 1 s, one at a time; other hosts do not wait', async () => {
    const r = rig();
    const f = makePoliteFetch({ doFetch: r.doFetch, spacer: r.spacer });
    await Promise.all([f('https://a.test/1'), f('https://a.test/2'), f('https://b.test/1'), f('https://a.test/3')]);
    const a = r.calls.filter((c) => c.url.startsWith('https://a.test'));
    const b = r.calls.filter((c) => c.url.startsWith('https://b.test'));
    expect(a.map((c) => c.url)).toEqual(['https://a.test/1', 'https://a.test/2', 'https://a.test/3']);
    expect(a[1]!.at - a[0]!.at).toBeGreaterThanOrEqual(1000);
    expect(a[2]!.at - a[1]!.at).toBeGreaterThanOrEqual(1000);
    expect(b[0]!.at).toBeLessThan(1000);
    expect(r.sleeps.every((ms) => ms > 0 && ms <= 1000)).toBe(true);
  });

  it('shares the spacing between fetch instances of the isolate', async () => {
    const r = rig();
    const one = makePoliteFetch({ doFetch: r.doFetch, spacer: r.spacer, namespace: 'aldi' });
    const two = makePoliteFetch({ doFetch: r.doFetch, spacer: r.spacer, namespace: 'aldi' });
    await Promise.all([one('https://a.test/1'), two('https://a.test/2')]);
    expect(r.calls[1]!.at - r.calls[0]!.at).toBeGreaterThanOrEqual(1000);
  });

  it('gives up after the timeout and aborts the request, even when fetch ignores the signal', async () => {
    let signal: AbortSignal | null = null;
    const hanging = ((_: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? null;
      return new Promise<Response>(() => undefined);
    }) as typeof fetch;
    const f = makePoliteFetch({ doFetch: hanging, timeoutMs: 20, spacer: new HostSpacer({ spacingMs: 0 }) });
    await expect(f('https://slow.test/x')).rejects.toBeInstanceOf(TimeoutError);
    expect(signal!.aborted).toBe(true);
  });

  it('times out a body that never ends', async () => {
    const stalled = (async () => new Response(new ReadableStream({ start() { /* never enqueues */ } }))) as typeof fetch;
    const f = makePoliteFetch({ doFetch: stalled, timeoutMs: 20, spacer: new HostSpacer({ spacingMs: 0 }) });
    await expect(f('https://slow.test/body')).rejects.toBeInstanceOf(TimeoutError);
  });

  it('keeps going without a Cache API (tests, Node)', async () => {
    const r = rig(() => new Response('hola', { status: 200 }));
    const f = makePoliteFetch({ doFetch: r.doFetch, spacer: r.spacer, cache: undefined });
    const res = await f('https://a.test/x');
    expect(await res.text()).toBe('hola');
    expect(res.headers.get(CACHE_HEADER)).toBeNull();
  });

  it('caches GET answers and flags the ones served from the cache', async () => {
    const r = rig(() => new Response('precio', { status: 200, headers: { 'set-cookie': 'a=b', 'content-type': 'text/html' } }));
    const cache = new FakeCache();
    const f = makePoliteFetch({ doFetch: r.doFetch, spacer: r.spacer, cache: cache as unknown as Cache, now: () => r.clock.t, namespace: 'alcampo' });
    const first = await f('https://a.test/search?q=leche', { kind: 'search' });
    expect(first.headers.get(CACHE_HEADER)).toBe('miss');
    expect(await first.text()).toBe('precio');
    const second = await f('https://a.test/search?q=leche', { kind: 'search' });
    expect(second.headers.get(CACHE_HEADER)).toBe('hit');
    expect(await second.text()).toBe('precio');
    expect(second.headers.get('content-type')).toBe('text/html');
    expect(r.calls).toHaveLength(1);
    expect(f.stats).toEqual({ network: 1, hits: 1 });
    // Stored without cookies, under the synthetic key.
    const [key, stored] = [...cache.store.entries()][0]!;
    expect(key).toMatch(/^https:\/\/cache\.cesta-compra\.internal\/alcampo\/search\/[0-9a-f]{64}$/);
    expect(stored.headers.get('set-cookie')).toBeNull();
    expect(stored.headers.get('cache-control')).toBe('public, max-age=21600');
  });

  it('expires by kind: search after 6 h, detail after 12 h, index after 24 h', async () => {
    const r = rig();
    const cache = new FakeCache();
    const f = makePoliteFetch({ doFetch: r.doFetch, spacer: r.spacer, cache: cache as unknown as Cache, now: () => r.clock.t });
    await f('https://a.test/s', { kind: 'search' });
    await f('https://a.test/d', { kind: 'detail' });
    await f('https://a.test/i', { kind: 'index' });
    r.clock.t += 7 * 3600_000;
    expect((await f('https://a.test/s', { kind: 'search' })).headers.get(CACHE_HEADER)).toBe('miss');
    expect((await f('https://a.test/d', { kind: 'detail' })).headers.get(CACHE_HEADER)).toBe('hit');
    r.clock.t += 6 * 3600_000;
    expect((await f('https://a.test/d', { kind: 'detail' })).headers.get(CACHE_HEADER)).toBe('miss');
    expect((await f('https://a.test/i', { kind: 'index' })).headers.get(CACHE_HEADER)).toBe('hit');
    r.clock.t += 12 * 3600_000;
    expect((await f('https://a.test/i', { kind: 'index' })).headers.get(CACHE_HEADER)).toBe('miss');
  });

  it('caches a POST only with an explicit cacheKey, and never a failed answer', async () => {
    const r = rig((url) => new Response('x', { status: url.endsWith('/404') ? 404 : 200 }));
    const cache = new FakeCache();
    const f = makePoliteFetch({ doFetch: r.doFetch, spacer: r.spacer, cache: cache as unknown as Cache, now: () => r.clock.t });
    await f('https://a.test/post', { method: 'POST', body: '{}' });
    await f('https://a.test/post', { method: 'POST', body: '{}' });
    expect(r.calls).toHaveLength(2);
    await f('https://a.test/post', { method: 'POST', body: '{"q":1}', cacheKey: 'q=1' });
    const hit = await f('https://a.test/post', { method: 'POST', body: '{"q":1}', cacheKey: 'q=1' });
    expect(hit.headers.get(CACHE_HEADER)).toBe('hit');
    expect(r.calls).toHaveLength(3);
    await f('https://a.test/404');
    const again = await f('https://a.test/404');
    expect(again.status).toBe(404);
    expect(again.headers.get(CACHE_HEADER)).toBeNull();
    expect(r.calls).toHaveLength(5);
  });

  it('builds distinct cache keys per namespace, kind, method, URL and cacheKey', async () => {
    const base = await cacheUrl('aldi', 'detail', 'GET', 'https://www.aldi.es/producto/x-1.html');
    expect(base.startsWith('https://cache.cesta-compra.internal/aldi/detail/')).toBe(true);
    expect(await cacheUrl('aldi', 'detail', 'GET', 'https://www.aldi.es/producto/x-1.html')).toBe(base);
    expect(await cacheUrl('aldi', 'index', 'GET', 'https://www.aldi.es/producto/x-1.html')).not.toBe(base);
    expect(await cacheUrl('aldi', 'detail', 'POST', 'https://www.aldi.es/producto/x-1.html', 'k')).not.toBe(base);
  });

  it('stops at its request budget without sending; cache hits and index requests are counted apart', async () => {
    const r = rig();
    const cache = new FakeCache();
    const f = makePoliteFetch({ doFetch: r.doFetch, spacer: r.spacer, cache: cache as unknown as Cache, now: () => r.clock.t, maxRequests: 2, maxIndexRequests: 1 });
    await f('https://a.test/1');
    await f('https://a.test/2');
    await f('https://a.test/1'); // a hit costs nothing
    await expect(f('https://a.test/3')).rejects.toBeInstanceOf(BudgetError);
    await f('https://a.test/sitemap.xml', { kind: 'index' });
    await expect(f('https://a.test/sitemap2.xml', { kind: 'index' })).rejects.toBeInstanceOf(BudgetError);
    expect(r.calls.map((c) => c.url)).toEqual(['https://a.test/1', 'https://a.test/2', 'https://a.test/sitemap.xml']);
  });

  it('passes a 204 through without a body', async () => {
    const r = rig(() => new Response(null, { status: 204 }));
    const f = makePoliteFetch({ doFetch: r.doFetch, spacer: r.spacer });
    const res = await f('https://a.test/empty');
    expect(res.status).toBe(204);
  });
});
