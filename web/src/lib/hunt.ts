/**
 * Background hunt queue: one hunt at a time, at least 1.5 s between starts,
 * cancellable, and pending hunts resume after a reload.
 */
import { useSyncExternalStore } from 'react';
import type { ChainId, HuntEvent } from '@shared/types';
import { huntBody, liveHeaders } from './api';
import { errorMessage, NETWORK_ERROR, readNdjson } from './ndjson';
import { getState, updateItem, type CartItem, type ChainHunt } from './store';

const GAP_MS = 1500;
const TIMEOUT_MS = 45_000;

let running: { id: string; ctrl: AbortController } | null = null;
let lastStart = 0;
let pumping = false;

/** Progress of the current batch, for the global "Buscando en los súper… 2/5" pill. */
export interface HuntProgress {
  active: boolean;
  done: number;
  total: number;
  current: string | null;
}

let progress: HuntProgress = { active: false, done: 0, total: 0, current: null };
const listeners = new Set<() => void>();

function setProgress(p: Partial<HuntProgress>) {
  progress = { ...progress, ...p };
  listeners.forEach((l) => l());
}

export function useHuntProgress(): HuntProgress {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => progress,
  );
}

const queued = () => getState().cart.filter((i) => i.hunt.status === 'queued').sort((a, b) => a.hunt.queuedAt - b.hunt.queuedAt);

function freshChains(): Partial<Record<ChainId, ChainHunt>> {
  const chains: Partial<Record<ChainId, ChainHunt>> = {};
  for (const c of getState().settings.chains) chains[c] = { status: 'pending', candidates: [], pick: null };
  return chains;
}

/** Queues (or re-queues) a hunt for an item. */
export function enqueue(id: string) {
  if (running?.id === id) running.ctrl.abort('requeue');
  if (!progress.active) setProgress({ active: true, done: 0, total: 0 });
  setProgress({ total: progress.total + 1 });
  updateItem(id, (i) => ({ ...i, choice: {}, hunt: { status: 'queued', chains: freshChains(), queuedAt: Date.now() } }));
  void pump();
}

/** Stops a queued or running hunt; chains that already answered keep their results. */
export function cancel(id: string) {
  const item = getState().cart.find((i) => i.id === id);
  if (!item || (item.hunt.status !== 'queued' && item.hunt.status !== 'running')) return;
  if (running?.id === id) running.ctrl.abort('cancel');
  finish(id, 'cancelled');
}

/** Called when an item is removed from the cart. */
export function forget(id: string) {
  if (running?.id === id) running.ctrl.abort('removed');
  if (progress.active) setProgress({ total: Math.max(progress.done, progress.total - 1) });
}

/** Resumes hunts left queued or running by a previous page load. */
export function resumePending() {
  const pending = getState().cart.filter((i) => i.hunt.status === 'queued' || i.hunt.status === 'running');
  if (!pending.length) return;
  for (const i of pending) {
    updateItem(i.id, (it) => ({ ...it, hunt: { ...it.hunt, status: 'queued', chains: freshChainsFor(it) } }));
  }
  setProgress({ active: true, done: 0, total: pending.length });
  void pump();
}

function freshChainsFor(item: CartItem) {
  const chains = freshChains();
  for (const c of Object.keys(chains) as ChainId[]) {
    const prev = item.hunt.chains[c];
    if (prev && prev.status !== 'pending') chains[c] = prev;
  }
  return chains;
}

function finish(id: string, status: 'done' | 'error' | 'cancelled', error?: string) {
  updateItem(id, (i) => {
    const chains = { ...i.hunt.chains };
    for (const c of Object.keys(chains) as ChainId[]) {
      const h = chains[c];
      if (h?.status === 'pending') {
        if (status === 'done') chains[c] = { status: 'error', candidates: [], pick: null, reason: 'No ha respondido a tiempo.' };
        else delete chains[c];
      }
    }
    return { ...i, hunt: { ...i.hunt, status, chains, ...(error ? { error } : { error: undefined }) } };
  });
  setProgress({ done: Math.min(progress.total, progress.done + 1) });
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const next = queued()[0];
      if (!next) break;
      const wait = lastStart + GAP_MS - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      const item = getState().cart.find((i) => i.id === next.id);
      if (!item || item.hunt.status !== 'queued') continue;
      lastStart = Date.now();
      await run(item);
    }
  } finally {
    pumping = false;
    running = null;
    setProgress({ current: null });
    if (progress.active && !queued().length) {
      // Keep "¡Listo!" visible for a moment, then hide the pill.
      setTimeout(() => {
        if (!running && !queued().length) setProgress({ active: false, done: 0, total: 0 });
      }, 2200);
    }
  }
}

async function run(item: CartItem) {
  const ctrl = new AbortController();
  running = { id: item.id, ctrl };
  setProgress({ current: item.product.name });
  updateItem(item.id, (i) => ({ ...i, hunt: { ...i.hunt, status: 'running' } }));
  const { settings } = getState();
  const body = huntBody(item, settings);
  // The server answers all 8 chains; the ones left out say 'unavailable' and are not shown.
  const asked = new Set<ChainId>(settings.chains);
  const timer = setTimeout(() => ctrl.abort('timeout'), TIMEOUT_MS);
  try {
    const res = await fetch('/api/hunt', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...liveHeaders(settings.liveKey) },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      finish(item.id, 'error', await errorMessage(res));
      return;
    }
    await readNdjson<HuntEvent>(res.body, (ev) => {
      if (ev.type !== 'chain' || !asked.has(ev.chain)) return;
      updateItem(item.id, (i) =>
        i.hunt.status !== 'running'
          ? i
          : {
              ...i,
              hunt: {
                ...i.hunt,
                chains: {
                  ...i.hunt.chains,
                  [ev.chain]: { status: ev.status, candidates: ev.candidates ?? [], pick: ev.pick ?? null, ...(ev.reason ? { reason: ev.reason } : {}) },
                },
              },
            },
      );
    });
    finish(item.id, 'done');
  } catch {
    const why = ctrl.signal.reason;
    if (why === 'cancel' || why === 'removed' || why === 'requeue') return;
    finish(item.id, 'error', why === 'timeout' ? 'La búsqueda ha tardado demasiado. Reinténtalo en un momento.' : NETWORK_ERROR);
  } finally {
    clearTimeout(timer);
    running = null;
  }
}

/** Whether any hunt is queued or running (for the cart summary). */
export function pendingCount(cart: CartItem[]): number {
  return cart.filter((i) => i.hunt.status === 'queued' || i.hunt.status === 'running').length;
}

/** Re-queues items whose hunt failed or met locked chains (used after a working live key is saved). */
export function retryLocked(): number {
  let n = 0;
  for (const i of getState().cart) {
    if (i.hunt.status === 'queued' || i.hunt.status === 'running') continue;
    const locked = Object.values(i.hunt.chains).some((h) => h?.status === 'locked');
    if (locked || i.hunt.status === 'error') {
      enqueue(i.id);
      n++;
    }
  }
  return n;
}
