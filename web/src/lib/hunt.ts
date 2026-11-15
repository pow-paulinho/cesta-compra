/**
 * Background hunt queue: one hunt at a time, at least 1.5 s between starts,
 * cancellable, and pending hunts resume after a reload.
 *
 * One queue for every open tab: the pump runs under a Web Lock, so a second tab
 * waits instead of asking the same chains again, and only the lock holder ever
 * moves a hunt from 'running' (an item left 'running' when the holder holds the
 * lock is an orphan from a closed tab or a reload, and is queued again).
 */
import { useSyncExternalStore } from 'react';
import { CHAINS } from '@shared/chains';
import type { ChainId, HuntEvent } from '@shared/types';
import { formatEuros } from '@shared/units';
import { huntBody, liveHeaders } from './api';
import { bestPrice } from './cart';
import { errorMessage, NETWORK_ERROR, readNdjson } from './ndjson';
import { getState, setRunningHere, subscribe, updateItem, type CartItem, type ChainHunt, type Hunt } from './store';

const GAP_MS = 1500;
const TIMEOUT_MS = 45_000;
const LOCK = 'cesta-hunt';
/** How long "¡Listo!" stays before the pill hides. */
const LINGER_MS = 2200;

let running: { id: string; queuedAt: number; ctrl: AbortController } | null = null;
let lastStart = 0;
let pumping = false;

setRunningHere(() => running?.id ?? null);

// ---------------------------------------------------------------------------
// Progress of the current batch, for the global "Buscando en los súper… 2/5" pill.
// Derived from the cart itself, so removing items, re-queuing one or another tab
// finishing a hunt can never make the count drift.
// ---------------------------------------------------------------------------

export interface HuntProgress {
  active: boolean;
  done: number;
  total: number;
  /** Name of the product being hunted now (in this tab or another). */
  current: string | null;
  /** The latest result in words ("Leche Pascual: mejor 1,21 € en Carrefour"), for a live region. */
  last: string | null;
}

let progress: HuntProgress = { active: false, done: 0, total: 0, current: null, last: null };
const listeners = new Set<() => void>();
/** Items of the current batch, and those of them already finished (they stay counted if removed). */
const batch = new Set<string>();
const finished = new Set<string>();
let hideTimer: ReturnType<typeof setTimeout> | null = null;

const isBusy = (i: CartItem) => i.hunt.status === 'queued' || i.hunt.status === 'running';

function setProgress(p: HuntProgress) {
  if (p.active === progress.active && p.done === progress.done && p.total === progress.total && p.current === progress.current && p.last === progress.last) return;
  progress = p;
  listeners.forEach((l) => l());
}

/** One sentence about an item whose hunt just ended. */
export function resultLine(item: CartItem): string | null {
  const name = item.product.name;
  if (item.hunt.status === 'error') return `${name}: la búsqueda ha fallado.`;
  if (item.hunt.status !== 'done') return null;
  const best = bestPrice(item, getState().settings);
  return best ? `${name}: mejor ${formatEuros(best.cents)} en ${CHAINS[best.chain]?.name ?? best.chain}.` : `${name}: sin precio en tus súper.`;
}

function recompute() {
  const { cart } = getState();
  let done = 0;
  let current: string | null = null;
  const said: string[] = [];
  for (const id of [...batch]) {
    const item = cart.find((i) => i.id === id);
    if (!item) {
      if (finished.has(id)) done++;
      else batch.delete(id);
      continue;
    }
    if (item.hunt.status === 'running') current ??= item.product.name;
    if (isBusy(item)) {
      finished.delete(id);
      continue;
    }
    done++;
    if (!finished.has(id)) {
      finished.add(id);
      const line = resultLine(item);
      if (line) said.push(line);
    }
  }
  const total = batch.size;
  const all = total > 0 && done >= total;
  if (all && !hideTimer) {
    hideTimer = setTimeout(() => {
      hideTimer = null;
      batch.clear();
      finished.clear();
      recompute();
    }, LINGER_MS);
  } else if (!all && hideTimer) {
    clearTimeout(hideTimer);
    hideTimer = null;
  }
  setProgress({ active: total > 0, done, total, current, last: said.length ? said.join(' ') : total ? progress.last : null });
}

/** Adds items to the batch the pill counts. */
function track(ids: string[]) {
  for (const id of ids) {
    batch.add(id);
    finished.delete(id);
  }
  recompute();
}

/** The progress right now (outside React). */
export const huntProgress = (): HuntProgress => progress;

export function useHuntProgress(): HuntProgress {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => progress,
  );
}

// ---------------------------------------------------------------------------
// Watching the store: progress, hunts acted on elsewhere, demo mode
// ---------------------------------------------------------------------------

let lastDemo = getState().settings.demo;

subscribe(() => {
  // The running item was removed, cancelled or queued again (here or in another tab): stop asking.
  if (running) {
    const item = getState().cart.find((i) => i.id === running!.id);
    if (!item) running.ctrl.abort('removed');
    else if (item.hunt.status === 'cancelled') running.ctrl.abort('cancel');
    else if (item.hunt.status !== 'running' || item.hunt.queuedAt !== running.queuedAt) running.ctrl.abort('requeue');
  }
  const { demo } = getState().settings;
  if (demo !== lastDemo) {
    lastDemo = demo;
    rehuntForMode();
  }
  if (batch.size) recompute();
});

/**
 * Demo prices and Open Prices never mix: after demo mode changes, hunt again the chains
 * whose answers came from the catalogue (live answers are the same in both modes).
 */
function rehuntForMode() {
  const { cart, settings } = getState();
  for (const i of cart) {
    if (i.hunt.demo === settings.demo) continue;
    const onlyLive = (c: ChainId) => {
      const h = i.hunt.chains[c];
      return h?.status === 'ok' && h.candidates.length > 0 && h.candidates.every((x) => x.source === 'live');
    };
    const redo = settings.chains.filter((c) => !onlyLive(c));
    if (redo.length) enqueue(i.id, redo.length === settings.chains.length ? {} : { chains: redo });
    else updateItem(i.id, (it) => ({ ...it, hunt: { ...it.hunt, demo: settings.demo } }));
  }
}

// ---------------------------------------------------------------------------
// Queue
// ---------------------------------------------------------------------------

const queued = () => getState().cart.filter((i) => i.hunt.status === 'queued').sort((a, b) => a.hunt.queuedAt - b.hunt.queuedAt);

const pendingChain = (): ChainHunt => ({ status: 'pending', candidates: [], pick: null });

/** The answers an item has now (pending ones replaced by what it had before this hunt). */
function answersOf(h: Hunt): Partial<Record<ChainId, ChainHunt>> {
  const out: Partial<Record<ChainId, ChainHunt>> = { ...(h.prev?.chains ?? {}) };
  for (const [c, a] of Object.entries(h.chains) as Array<[ChainId, ChainHunt | undefined]>) if (a && a.status !== 'pending') out[c] = a;
  return out;
}

/** Chains whose answer failed for a reason that may pass (a timeout, a source that was down). */
export function failedChains(item: CartItem, chains: ChainId[]): ChainId[] {
  return chains.filter((c) => {
    const h = item.hunt.chains[c];
    return h?.status === 'error' || h?.status === 'unavailable';
  });
}

/**
 * Queues (or re-queues) a hunt for an item. With `chains`, only those chains are asked
 * again and the others keep their answers and choices. Until the new answers arrive the
 * old ones are kept aside, and a cancel or a failed hunt puts them back.
 */
export function enqueue(id: string, opts: { chains?: ChainId[] } = {}) {
  const item = getState().cart.find((i) => i.id === id);
  if (!item) return;
  const { settings } = getState();
  const only = opts.chains ? opts.chains.filter((c) => settings.chains.includes(c)) : null;
  if (only && !only.length) return;
  if (running?.id === id) running.ctrl.abort('requeue');
  updateItem(id, (i) => {
    const before = answersOf(i.hunt);
    const prevChoice = i.hunt.prev?.choice ?? i.choice;
    const chains: Partial<Record<ChainId, ChainHunt>> = {};
    const choice: Partial<Record<ChainId, string>> = {};
    for (const c of settings.chains) {
      if (!only || only.includes(c)) chains[c] = pendingChain();
      else {
        if (before[c]) chains[c] = before[c];
        if (i.choice[c]) choice[c] = i.choice[c];
      }
    }
    const hunt: Hunt = { status: 'queued', chains, queuedAt: Date.now(), demo: settings.demo, prev: { chains: before, choice: prevChoice } };
    if (only) hunt.only = only;
    return { ...i, choice, hunt };
  });
  track([id]);
  void pump();
}

/** Asks again only the chains that failed for this item. Returns how many. */
export function retryFailed(id: string): number {
  const item = getState().cart.find((i) => i.id === id);
  if (!item || isBusy(item)) return 0;
  const chains = failedChains(item, getState().settings.chains);
  if (chains.length) enqueue(id, { chains });
  return chains.length;
}

/** Stops a queued or running hunt; chains that already answered keep their results. */
export function cancel(id: string) {
  const item = getState().cart.find((i) => i.id === id);
  if (!item || !isBusy(item)) return;
  if (running?.id === id) running.ctrl.abort('cancel');
  finish(id, 'cancelled');
}

/** Called when an item is removed from the cart. */
export function forget(id: string) {
  if (running?.id === id) running.ctrl.abort('removed');
}

/**
 * Picks up hunts left queued or running by a previous page load. Safe to call more
 * than once (React StrictMode runs mount effects twice): it only counts them and
 * starts the pump, which adopts orphans once it holds the lock.
 */
export function resumePending() {
  const pending = getState().cart.filter(isBusy);
  if (!pending.length) return;
  track(pending.map((i) => i.id));
  void pump();
}

function finish(id: string, status: 'done' | 'error' | 'cancelled', error?: string) {
  updateItem(id, (i) => {
    const prev = i.hunt.prev;
    const chains = { ...i.hunt.chains };
    let choice = i.choice;
    for (const c of Object.keys(chains) as ChainId[]) {
      if (chains[c]?.status !== 'pending') continue;
      if (status === 'done') chains[c] = { status: 'error', candidates: [], pick: null, reason: 'No ha respondido a tiempo.' };
      else if (prev?.chains[c]) {
        chains[c] = prev.chains[c];
        if (prev.choice[c]) choice = { ...choice, [c]: prev.choice[c] };
      } else delete chains[c];
    }
    const hunt: Hunt = { status, chains, queuedAt: i.hunt.queuedAt };
    if (i.hunt.demo !== undefined) hunt.demo = i.hunt.demo;
    if (error) hunt.error = error;
    return { ...i, choice, hunt };
  });
}

/** Runs `fn` while holding the queue's lock, shared by every tab (or directly without Web Locks). */
async function withLock(fn: () => Promise<void>): Promise<void> {
  const locks = (globalThis as { navigator?: { locks?: { request(name: string, fn: () => Promise<void>): Promise<unknown> } } }).navigator?.locks;
  if (!locks?.request) return fn();
  await locks.request(LOCK, fn);
}

/** Holding the lock means no other tab is hunting: anything left 'running' is an orphan. */
function adoptOrphans() {
  for (const i of getState().cart) {
    if (i.hunt.status !== 'running' || i.id === running?.id) continue;
    updateItem(i.id, (it) => ({ ...it, hunt: { ...it.hunt, status: 'queued' } }));
  }
}

async function pump() {
  if (pumping) return;
  pumping = true;
  try {
    await withLock(async () => {
      adoptOrphans();
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
    });
  } finally {
    pumping = false;
    running = null;
    if (batch.size) recompute();
    // Something queued while the lock was being let go.
    if (queued().length) void pump();
  }
}

async function run(item: CartItem) {
  const ctrl = new AbortController();
  const { settings } = getState();
  running = { id: item.id, queuedAt: item.hunt.queuedAt, ctrl };
  updateItem(item.id, (i) => ({ ...i, hunt: { ...i.hunt, status: 'running', demo: settings.demo } }));
  const chains = item.hunt.only?.length ? item.hunt.only.filter((c) => settings.chains.includes(c)) : settings.chains;
  const body = huntBody(item, { ...settings, chains });
  // The server answers all 8 chains; the ones left out say 'unavailable' and are not shown.
  const asked = new Set<ChainId>(chains);
  const timer = setTimeout(() => ctrl.abort('timeout'), TIMEOUT_MS);
  const mine = (i: CartItem) => i.hunt.status === 'running' && i.hunt.queuedAt === item.hunt.queuedAt;
  try {
    const res = await fetch('/api/hunt', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...liveHeaders(settings.liveKey) },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok || !res.body) {
      const message = await errorMessage(res);
      if (!ctrl.signal.aborted) finish(item.id, 'error', message);
      return;
    }
    await readNdjson<HuntEvent>(res.body, (ev) => {
      if (ev.type !== 'chain' || !asked.has(ev.chain)) return;
      updateItem(item.id, (i) =>
        !mine(i)
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
    if (ctrl.signal.aborted) return;
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
  return cart.filter(isBusy).length;
}

/** Re-queues items whose hunt failed or met locked chains (used after a working live key is saved). */
export function retryLocked(): number {
  let n = 0;
  for (const i of getState().cart) {
    if (isBusy(i)) continue;
    const locked = Object.values(i.hunt.chains).some((h) => h?.status === 'locked');
    if (locked || i.hunt.status === 'error') {
      enqueue(i.id);
      n++;
    }
  }
  return n;
}
