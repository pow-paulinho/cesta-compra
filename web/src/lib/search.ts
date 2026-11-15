/** Streaming product search: /api/search NDJSON, merged per product key as sources answer. */
import { useEffect, useRef, useState } from 'react';
import type { ChainStatus, Product, SearchEvent, SearchSource } from '@shared/types';
import { CHAINS } from '@shared/chains';
import { liveHeaders, searchUrl } from './api';
import { errorMessage, NETWORK_ERROR, readNdjson } from './ndjson';
import { mergeInto, rememberProducts } from './products';

export interface SourceState {
  source: SearchSource;
  status: ChainStatus | 'pending';
  count: number;
  reason?: string;
}

export interface SearchState {
  q: string;
  phase: 'idle' | 'loading' | 'done' | 'error';
  sources: SourceState[];
  products: Product[];
  error?: string;
}

/**
 * Sources the server answers for every search: the catalogue, Open Food Facts and the chains
 * marked live (each answers ok, none, locked, blocked, error, or unavailable when not wired).
 */
const EXPECTED: SearchSource[] = ['catalogo', 'openfoodfacts', ...Object.values(CHAINS).filter((c) => c.mode === 'live').map((c) => c.id)];

export function sourceName(s: SearchSource): string {
  if (s === 'catalogo') return 'Catálogo';
  if (s === 'openfoodfacts') return 'Open Food Facts';
  return CHAINS[s]?.name ?? s;
}

const blank = (q: string): SearchState => ({
  q,
  phase: q ? 'loading' : 'idle',
  sources: q ? EXPECTED.map((source) => ({ source, status: 'pending', count: 0 })) : [],
  products: [],
});

export function useSearch(q: string, liveKey: string, demo: boolean, attempt: number): SearchState {
  const [state, setState] = useState<SearchState>(() => blank(q));
  const ctrlRef = useRef<AbortController | null>(null);

  useEffect(() => {
    ctrlRef.current?.abort();
    setState(blank(q));
    if (!q) return;
    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    (async () => {
      try {
        const res = await fetch(searchUrl(q, demo), {
          headers: liveHeaders(liveKey),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const error = await errorMessage(res);
          if (!ctrl.signal.aborted) setState((s) => ({ ...s, phase: 'error', error }));
          return;
        }
        await readNdjson<SearchEvent>(res.body, (ev) => {
          if (ctrl.signal.aborted) return;
          if (ev.type === 'done') return;
          rememberProducts(ev.products);
          setState((s) => {
            const has = s.sources.some((x) => x.source === ev.source);
            const entry: SourceState = { source: ev.source, status: ev.status, count: ev.products.length, ...(ev.reason ? { reason: ev.reason } : {}) };
            const sources = has ? s.sources.map((x) => (x.source === ev.source ? entry : x)) : [...s.sources, entry];
            let products = s.products;
            for (const p of ev.products) products = mergeInto(products, p);
            return { ...s, sources, products };
          });
        });
        if (!ctrl.signal.aborted) {
          setState((s) => ({
            ...s,
            phase: 'done',
            // A source that never answered is shown as unavailable, not "searching" forever.
            sources: s.sources.map((x) => (x.status === 'pending' ? { ...x, status: 'unavailable', reason: 'No ha respondido.' } : x)),
          }));
        }
      } catch {
        if (!ctrl.signal.aborted) setState((s) => ({ ...s, phase: 'error', error: NETWORK_ERROR }));
      }
    })();
    return () => ctrl.abort();
  }, [q, liveKey, demo, attempt]);

  return state;
}
