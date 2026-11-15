/** Hash routing: #/buscar?q=leche&p=<product key>, #/cesta, #/plan; `ajustes=1` opens Settings. */
import { useSyncExternalStore } from 'react';

export type Path = '/buscar' | '/cesta' | '/plan';

export interface Route {
  path: Path;
  params: URLSearchParams;
}

function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/buscar';
  const [p = '/buscar', query = ''] = raw.split('?');
  const path: Path = p === '/cesta' || p === '/plan' ? p : '/buscar';
  return { path, params: new URLSearchParams(query) };
}

let current = parse(typeof location === 'undefined' ? '' : location.hash);
/** The history entry the app pushed for the open overlay, if any. */
let overlayEntry: string | null = null;
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    current = parse(location.hash);
    listeners.forEach((l) => l());
  });
}

export function useRoute(): Route {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}

export function hrefFor(path: Path, params?: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params ?? {})) if (v != null && v !== '') q.set(k, v);
  const s = q.toString();
  return `#${path}${s ? `?${s}` : ''}`;
}

export function navigate(path: Path, params?: Record<string, string | null | undefined>, opts: { replace?: boolean } = {}) {
  const href = hrefFor(path, params);
  if (href === location.hash) return;
  if (opts.replace) {
    history.replaceState(history.state, '', href);
    current = parse(href);
    listeners.forEach((l) => l());
  } else {
    location.hash = href;
  }
}

/** Opens an overlay (product sheet, settings) on top of the current screen. */
export function openOverlay(name: 'p' | 'ajustes', value: string) {
  const params = Object.fromEntries(current.params);
  delete params.p;
  delete params.ajustes;
  const wasPushed = overlayEntry === location.hash;
  const replace = current.params.has('p') || current.params.has('ajustes');
  const next = { ...params, [name]: value };
  navigate(current.path, next, { replace });
  if (!replace || wasPushed) overlayEntry = hrefFor(current.path, next);
}

/** Closes overlays: goes back when the app opened them, so the browser back button stays consistent. */
export function closeOverlay() {
  if (overlayEntry && overlayEntry === location.hash) {
    overlayEntry = null;
    history.back();
    return;
  }
  const params = Object.fromEntries(current.params);
  delete params.p;
  delete params.ajustes;
  navigate(current.path, params, { replace: true });
}
