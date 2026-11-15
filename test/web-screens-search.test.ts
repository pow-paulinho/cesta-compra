/**
 * web/src/lib/search.ts: finished searches are reused for a few minutes (going to Cesta and
 * back no longer asks every source again, finding weblogic-4), and the streaming reducers.
 */
import { describe, expect, it, vi } from 'vitest';
import type { Product } from '../src/shared/types';
import { applySourceEvent, cachedSearch, finishSearch, forgetSearch, rememberSearch, SEARCH_TTL_MS, type SearchState } from '../web/src/lib/search';

vi.mock('@shared/types', () => import('../src/shared/types'));
vi.mock('@shared/chains', () => import('../src/shared/chains'));

const product = (key: string): Product => ({ key, name: key, brand: null, sizeText: null, ean: null, image: null, offers: [] });

const done = (q: string, n = 2): SearchState => ({
  q,
  phase: 'done',
  sources: [{ source: 'catalogo', status: 'ok', count: n }],
  products: Array.from({ length: n }, (_, i) => product(`name:${q} ${i}`)),
});

describe('the search cache', () => {
  it('gives a finished search back for the same words, key and demo setting, within the TTL', () => {
    const t = 1_000_000;
    rememberSearch(done('leche'), '', false, t);
    expect(cachedSearch('leche', '', false, t + 60_000)?.products).toHaveLength(2);
    // Another key or demo setting can give other prices: not reused.
    expect(cachedSearch('leche', 'clave', false, t + 1)).toBeNull();
    expect(cachedSearch('leche', '', true, t + 1)).toBeNull();
    // Too old: asked again.
    expect(cachedSearch('leche', '', false, t + SEARCH_TTL_MS + 1)).toBeNull();
  });

  it('never keeps a search that is still loading or failed', () => {
    rememberSearch({ ...done('huevos'), phase: 'loading' }, '', false, 5);
    rememberSearch({ ...done('café'), phase: 'error', error: 'x' }, '', false, 5);
    expect(cachedSearch('huevos', '', false, 6)).toBeNull();
    expect(cachedSearch('café', '', false, 6)).toBeNull();
  });

  it('forgets a query the person submits again, so that one is fresh', () => {
    rememberSearch(done('atún'), '', false, 10);
    rememberSearch(done('atún'), 'clave', false, 10);
    forgetSearch('atún');
    expect(cachedSearch('atún', '', false, 11)).toBeNull();
    expect(cachedSearch('atún', 'clave', false, 11)).toBeNull();
  });
});

describe('streaming a search', () => {
  it('updates a source pill and merges its products by key', () => {
    const start: SearchState = {
      q: 'leche',
      phase: 'loading',
      sources: [
        { source: 'catalogo', status: 'pending', count: 0 },
        { source: 'aldi', status: 'pending', count: 0 },
      ],
      products: [product('ean:1')],
    };
    const next = applySourceEvent(start, { type: 'source', source: 'aldi', status: 'ok', products: [product('ean:1'), product('ean:2')], ms: 5 });
    expect(next.sources.find((s) => s.source === 'aldi')).toEqual({ source: 'aldi', status: 'ok', count: 2 });
    expect(next.products.map((p) => p.key)).toEqual(['ean:1', 'ean:2']);
    const ended = finishSearch(next);
    expect(ended.phase).toBe('done');
    expect(ended.sources.find((s) => s.source === 'catalogo')?.status).toBe('unavailable');
  });
});
