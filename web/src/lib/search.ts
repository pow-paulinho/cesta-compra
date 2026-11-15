/** Streaming product search: /api/search NDJSON, merged per product key as sources answer. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
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

/** What each source is called on screen: what it gives you, not the name of the dataset. */
export function sourceName(s: SearchSource): string {
  if (s === 'catalogo') return 'Precios guardados';
  if (s === 'openfoodfacts') return 'Fotos e ingredientes';
  return CHAINS[s]?.name ?? s;
}

/** "Aldi", "Aldi y Lidl", "Alcampo, Aldi y Ahorramas". */
export function joinList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** Why live chains are locked: no key yet, a key that does not match, or live search off on the server. */
export type LockKind = 'missing' | 'wrong' | 'disabled';

export function lockKind(locked: Pick<SourceState, 'reason'>[], hasKey: boolean): LockKind {
  // The Worker's wording (src/live/auth.ts lockedReason) says when live search is off on the server.
  if (locked.some((s) => s.reason && /no está activada/i.test(s.reason))) return 'disabled';
  return hasKey ? 'wrong' : 'missing';
}

/** One line for all the locked chains instead of one amber pill each. */
export function lockedLine(names: string[], kind: LockKind): string {
  const list = joinList(names);
  if (kind === 'disabled') return `${list}: la búsqueda en directo está apagada en el servidor`;
  if (kind === 'wrong') return `Tu clave no funciona: sin ${list} en directo`;
  return `${list} ${names.length === 1 ? 'necesita' : 'necesitan'} tu clave`;
}

/** The text of a source pill after its name. */
export function pillStatus(s: Pick<SourceState, 'status' | 'count'>): string {
  switch (s.status) {
    case 'pending':
      return 'buscando…';
    case 'ok':
      return `${s.count} ${s.count === 1 ? 'encontrado' : 'encontrados'}`;
    case 'none':
      return 'sin resultados';
    case 'locked':
      return 'sin clave';
    case 'blocked':
      return 'bloqueado';
    case 'unavailable':
      return 'no disponible';
    default:
      return 'error';
  }
}

/**
 * What the polite live region says: once when a search starts and once when it ends, with the
 * number of products, instead of a countdown of sources (finding a11y-10).
 */
export function searchAnnouncement(s: Pick<SearchState, 'q' | 'phase' | 'products' | 'sources'>): string {
  if (!s.q) return '';
  if (s.phase === 'loading') return `Buscando «${s.q}»…`;
  if (s.phase !== 'done') return ''; // errors are announced by their own alert
  const n = s.products.length;
  const found = n ? `${n} ${n === 1 ? 'producto' : 'productos'} para «${s.q}».` : `No hemos encontrado «${s.q}».`;
  const locked = s.sources.filter((x) => x.status === 'locked').length;
  const lockedText = locked ? ` ${locked} ${locked === 1 ? 'súper necesita' : 'súper necesitan'} tu clave para buscar en directo.` : '';
  return found + lockedText;
}

const blank = (q: string): SearchState => ({
  q,
  phase: q ? 'loading' : 'idle',
  sources: q ? EXPECTED.map((source) => ({ source, status: 'pending', count: 0 })) : [],
  products: [],
});

/** One source answered: its pill updates and its products are merged in by key. */
export function applySourceEvent(s: SearchState, ev: Extract<SearchEvent, { type: 'source' }>): SearchState {
  const has = s.sources.some((x) => x.source === ev.source);
  const entry: SourceState = { source: ev.source, status: ev.status, count: ev.products.length, ...(ev.reason ? { reason: ev.reason } : {}) };
  const sources = has ? s.sources.map((x) => (x.source === ev.source ? entry : x)) : [...s.sources, entry];
  let products = s.products;
  for (const p of ev.products) products = mergeInto(products, p);
  return { ...s, sources, products };
}

/** The stream ended: a source that never answered is shown as unavailable, not "searching" forever. */
export function finishSearch(s: SearchState): SearchState {
  return {
    ...s,
    phase: 'done',
    sources: s.sources.map((x) => (x.status === 'pending' ? { ...x, status: 'unavailable', reason: 'No ha respondido.' } : x)),
  };
}

// ---------------------------------------------------------------------------
// Finished searches, kept for a few minutes: going to Cesta and back (tab, browser
// back) shows the same results at once instead of asking every source again.
// ---------------------------------------------------------------------------

export const SEARCH_TTL_MS = 5 * 60_000;
const MAX_CACHED = 12;
const finished = new Map<string, { state: SearchState; at: number }>();
const cacheKey = (q: string, liveKey: string, demo: boolean) => `${demo ? 'demo' : 'real'}|${liveKey}|${q}`;

export function cachedSearch(q: string, liveKey: string, demo: boolean, now = Date.now()): SearchState | null {
  const hit = finished.get(cacheKey(q, liveKey, demo));
  if (!hit) return null;
  if (now - hit.at > SEARCH_TTL_MS) {
    finished.delete(cacheKey(q, liveKey, demo));
    return null;
  }
  return hit.state;
}

export function rememberSearch(state: SearchState, liveKey: string, demo: boolean, now = Date.now()) {
  if (state.phase !== 'done' || !state.q) return;
  const key = cacheKey(state.q, liveKey, demo);
  finished.delete(key); // re-insert last, so the oldest is dropped first
  finished.set(key, { state, at: now });
  while (finished.size > MAX_CACHED) finished.delete(finished.keys().next().value!);
}

/** The person asked for this search again (submitted it): the next run asks every source. */
export function forgetSearch(q: string) {
  for (const [key, hit] of finished) if (hit.state.q === q) finished.delete(key);
}

// ---------------------------------------------------------------------------
// What the search screen is doing, for the rest of the app: the header mascot
// looks around while a search runs, and the Buscar tab returns to the last query.
// ---------------------------------------------------------------------------

export interface SearchActivity {
  /** The query on the Buscar screen the last time it was shown ('' for the home view). */
  q: string;
  loading: boolean;
}

let activity: SearchActivity = { q: '', loading: false };
const activityListeners = new Set<() => void>();

function setActivity(next: SearchActivity) {
  if (next.q === activity.q && next.loading === activity.loading) return;
  activity = next;
  activityListeners.forEach((l) => l());
}

export function getSearchActivity(): SearchActivity {
  return activity;
}

export function useSearchActivity(): SearchActivity {
  return useSyncExternalStore(
    (l) => {
      activityListeners.add(l);
      return () => {
        activityListeners.delete(l);
      };
    },
    getSearchActivity,
    getSearchActivity,
  );
}

export function useSearch(q: string, liveKey: string, demo: boolean, attempt: number): SearchState {
  const [state, setState] = useState<SearchState>(() => cachedSearch(q, liveKey, demo) ?? blank(q));
  const seenAttempt = useRef(attempt);

  useEffect(() => {
    // «Reintentar» or submitting the same words again: always ask the sources.
    const retry = attempt !== seenAttempt.current;
    seenAttempt.current = attempt;
    const hit = retry ? null : cachedSearch(q, liveKey, demo);
    if (!q || hit) {
      setState(hit ?? blank(q));
      setActivity({ q, loading: false });
      return;
    }
    let acc = blank(q);
    setState(acc);
    setActivity({ q, loading: true });
    const ctrl = new AbortController();
    const update = (next: SearchState) => {
      acc = next;
      setState(next);
    };
    (async () => {
      try {
        const res = await fetch(searchUrl(q, demo), {
          headers: liveHeaders(liveKey),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const error = await errorMessage(res);
          if (!ctrl.signal.aborted) update({ ...acc, phase: 'error', error });
          return;
        }
        await readNdjson<SearchEvent>(res.body, (ev) => {
          if (ctrl.signal.aborted || ev.type === 'done') return;
          rememberProducts(ev.products);
          update(applySourceEvent(acc, ev));
        });
        if (!ctrl.signal.aborted) {
          update(finishSearch(acc));
          rememberSearch(acc, liveKey, demo);
        }
      } catch {
        if (!ctrl.signal.aborted) update({ ...acc, phase: 'error', error: NETWORK_ERROR });
      } finally {
        if (!ctrl.signal.aborted) setActivity({ q, loading: false });
      }
    })();
    return () => {
      ctrl.abort();
      setActivity({ q: activity.q, loading: false });
    };
  }, [q, liveKey, demo, attempt]);

  // For the one render between a new query and its effect, never show the previous query's results.
  if (state.q !== q) return cachedSearch(q, liveKey, demo) ?? blank(q);
  return state;
}
