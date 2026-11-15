import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BLOCK_429_MS, BlockBook, StillBlockedError, failure, guardedCache, runAdapter, worthCaching, type LiveDeps,
} from '../src/live/common';
import { alcampo } from '../src/sources/live/alcampo';
import { aldi, ALDI_SITEMAP_URL } from '../src/sources/live/aldi';
import { HostSpacer, makePoliteFetch } from '../src/sources/live/http';
import { clearSitemapCache } from '../src/sources/live/sitemap';
import { BlockedError } from '../src/sources/live/types';

const aldiFixture = (p: string) => readFileSync(new URL(`./fixtures/aldi/${p}`, import.meta.url), 'utf8');
const ALCAMPO_PRODUCT = readFileSync(new URL('./fixtures/alcampo/product-page.html', import.meta.url), 'utf8');
const SITEMAP = aldiFixture('sitemap-products.xml');
const PRODUCT = aldiFixture('product-leche-entera-80000.html');
const CHALLENGE = '<html><head><title>Pardon Our Interruption</title></head><body>Please verify you are a human.</body></html>';

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

function rig(answer: (url: string, n: number) => Response, opts: { cache?: Cache; blocks?: BlockBook } = {}) {
  const sent: string[] = [];
  const clock = { t: Date.parse('2026-11-15T12:00:00Z') };
  const doFetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    sent.push(url);
    return answer(url, sent.length);
  }) as typeof fetch;
  const deps: LiveDeps = {
    adapters: {},
    off: {},
    fetchFor: (namespace) => makePoliteFetch({ doFetch, namespace, cache: opts.cache, spacer: new HostSpacer({ spacingMs: 0 }) }),
    now: () => new Date(clock.t),
    deadlineMs: 5000,
    blocks: opts.blocks,
  };
  return { deps, sent, clock };
}

beforeEach(() => clearSitemapCache());

describe('a source that refused us is left alone for a while', () => {
  it('honours Retry-After: one request to Alcampo for five searches after a 429', async () => {
    const r = rig(() => new Response('Too Many Requests', { status: 429, headers: { 'retry-after': '3600' } }), { blocks: new BlockBook() });
    const errors: unknown[] = [];
    for (const q of ['leche', 'pan', 'huevos', 'aceite', 'arroz']) errors.push(await runAdapter(alcampo, q, r.deps).catch((e: unknown) => e));
    expect(r.sent).toHaveLength(1);
    expect(errors[0]).toBeInstanceOf(BlockedError);
    expect(errors.slice(1).every((e) => e instanceof StillBlockedError)).toBe(true);
    expect(failure(errors[1], 'Alcampo')).toEqual({
      status: 'blocked', reason: 'Alcampo ha rechazado nuestras consultas hace poco: esperamos 60 min antes de volver a preguntar.',
    });
    // An hour later it is asked again.
    r.clock.t += 3600_000;
    await runAdapter(alcampo, 'leche', r.deps).catch(() => undefined);
    expect(r.sent).toHaveLength(2);
  });

  it('without Retry-After, waits 15 min after a 429 and 1 h after a 403', () => {
    const book = new BlockBook();
    book.record('alcampo', 429, 0, null);
    book.record('aldi', 403, 0, null);
    expect(book.check('alcampo', BLOCK_429_MS - 1)).not.toBeNull();
    expect(book.check('alcampo', BLOCK_429_MS)).toBeNull();
    expect(book.check('aldi', 59 * 60_000)).not.toBeNull();
    expect(book.check('aldi', 60 * 60_000)).toBeNull();
    // A huge Retry-After is capped at 6 h.
    book.record('ahorramas', 429, 0, 30 * 24 * 3600_000);
    expect(book.check('ahorramas', 6 * 3600_000)).toBeNull();
  });

  it('a challenge page served with 200 counts as a refusal too', async () => {
    const r = rig((url) => (url === ALDI_SITEMAP_URL ? new Response(CHALLENGE) : new Response(PRODUCT)), { blocks: new BlockBook() });
    const first = await runAdapter(aldi, 'leche', r.deps).catch((e: unknown) => e);
    expect(first).toBeInstanceOf(BlockedError);
    expect(failure(first, 'Aldi')).toEqual({ status: 'blocked', reason: 'Aldi ha rechazado la consulta automática: no insistimos.' });
    await expect(runAdapter(aldi, 'leche', r.deps)).rejects.toBeInstanceOf(StillBlockedError);
    expect(r.sent).toHaveLength(1);
  });
});

describe('what the cache keeps', () => {
  it('never a challenge page, an Alcampo page without state, or Open Food Facts answers that are not JSON', () => {
    const at = (ns: string) => `https://cache.cesta-compra.internal/${ns}/search/abc`;
    expect(worthCaching(at('aldi'), CHALLENGE)).toBe(false);
    expect(worthCaching(at('aldi'), PRODUCT)).toBe(true);
    expect(worthCaching(at('alcampo'), '<html><script>window.AwsWafIntegration = {}</script></html>')).toBe(false);
    expect(worthCaching(at('alcampo'), ALCAMPO_PRODUCT)).toBe(true);
    expect(worthCaching(at('openfoodfacts'), '<html>Service unavailable</html>')).toBe(false);
    expect(worthCaching(at('openfoodfacts'), '{"products":[]}')).toBe(true);
  });

  it('a challenge served once is not replayed after the site recovers', async () => {
    const cache = new FakeCache();
    const guarded = guardedCache(cache as unknown as Cache);
    let recovered = false;
    const r = rig((url) => {
      if (!recovered) return new Response(CHALLENGE);
      return url === ALDI_SITEMAP_URL ? new Response(SITEMAP) : new Response(PRODUCT);
    }, { cache: guarded });
    await expect(runAdapter(aldi, 'leche entera', r.deps)).rejects.toBeInstanceOf(BlockedError);
    expect(cache.store.size).toBe(0);
    recovered = true;
    const offers = await runAdapter(aldi, 'leche entera', r.deps);
    expect(offers.length).toBeGreaterThan(0);
    expect(r.sent[1]).toBe(ALDI_SITEMAP_URL);
    // Good answers are still kept.
    expect(cache.store.size).toBeGreaterThan(0);
  });

  it('a cache that is not there stays not there', () => {
    expect(guardedCache(undefined)).toBeUndefined();
    expect(guardedCache(null)).toBeUndefined();
  });
});
