import { describe, expect, it } from 'vitest';
import worker, { type Env } from '../src/index';

/* The page is now the built web app in dist/client, served by Workers static assets
   (wrangler.jsonc "assets"). The Worker only answers /api/* and /health itself. */

function fakeAssets() {
  const asked: string[] = [];
  const ASSETS = {
    fetch: async (input: RequestInfo | URL) => {
      asked.push(new Request(input).url);
      return new Response('<!doctype html><html lang="es"></html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });
    },
  } as unknown as Fetcher;
  return { ASSETS, asked };
}

function fakeDb(rows: unknown[] = [], first: unknown = { n: 0 }) {
  return {
    prepare: () => ({
      bind: () => ({ all: async () => ({ results: rows }) }),
      all: async () => ({ results: rows }),
      first: async () => first,
    }),
  } as unknown as D1Database;
}

describe('the web app and the routes around it', () => {
  it('hands every non-API path to the static assets', async () => {
    const { ASSETS, asked } = fakeAssets();
    for (const path of ['/', '/index.html', '/assets/app.js', '/cesta']) {
      const res = await worker.fetch(new Request(`https://x.test${path}`), { ASSETS } as Env);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/html');
    }
    expect(asked).toEqual(['https://x.test/', 'https://x.test/index.html', 'https://x.test/assets/app.js', 'https://x.test/cesta']);
  });

  it('answers 404 for non-API paths when there are no assets (tests, a Worker without a build)', async () => {
    expect((await worker.fetch(new Request('https://x.test/'), {} as Env)).status).toBe(404);
    expect((await worker.fetch(new Request('https://x.test/nope'), {} as Env)).status).toBe(404);
  });

  it('never hands /api or /health to the assets', async () => {
    const { ASSETS, asked } = fakeAssets();
    const health = await worker.fetch(new Request('https://x.test/health'), { ASSETS } as Env);
    expect(await health.json()).toEqual({ ok: true, app: 'cesta-compra' });
    const nope = await worker.fetch(new Request('https://x.test/api/nope'), { ASSETS } as Env);
    expect(nope.status).toBe(404);
    expect(((await nope.json()) as { error: string }).error).toContain('/api/nope');
    expect(asked).toEqual([]);
  });

  it('keeps /api/products and /api/status answering as before', async () => {
    const rows = [{ ean: '8076809579346', name: 'Pesto alla genovese', brand: 'Barilla', size: '190 g', chain: 'Consum', source: 'open_prices', price_cents: 299, observed_on: '2026-02-06', place: null }];
    const products = await worker.fetch(new Request('https://x.test/api/products?q=pesto'), { DB: fakeDb(rows) } as Env);
    expect(products.status).toBe(200);
    expect(((await products.json()) as { products: Array<{ ean: string }> }).products.map((p) => p.ean)).toEqual(['8076809579346']);
    const status = await worker.fetch(new Request('https://x.test/api/status'), { DB: fakeDb([], { n: 50 }) } as Env);
    expect(await status.json()).toEqual({ products: 50, prices: [], imports: [] });
  });
});
