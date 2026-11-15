/**
 * App state: cart, hunts, settings, recent searches and savings history.
 * Kept in localStorage under `cesta.v2` (versioned; every access guarded).
 */
import { useSyncExternalStore } from 'react';
import { CHAIN_IDS, type Candidate, type ChainId, type ChainStatus, type HuntMode, type Offer, type Product } from '@shared/types';

export const STORAGE_KEY = 'cesta.v2';

export type ChainHuntStatus = ChainStatus | 'pending';

export interface ChainHunt {
  status: ChainHuntStatus;
  candidates: Candidate[];
  pick: Candidate | null;
  reason?: string;
}

export type HuntStatus = 'queued' | 'running' | 'done' | 'error' | 'cancelled';

export interface Hunt {
  status: HuntStatus;
  chains: Partial<Record<ChainId, ChainHunt>>;
  error?: string;
  queuedAt: number;
  /** Whether the hunt asked for demo prices (absent on hunts saved before this was recorded). */
  demo?: boolean;
  /** A retry of some chains only: the others keep their answers. */
  only?: ChainId[];
  /** What the item had before this hunt was queued, put back if it is cancelled or fails. */
  prev?: { chains: Partial<Record<ChainId, ChainHunt>>; choice: Partial<Record<ChainId, string>> };
}

export type CartProduct = Pick<Product, 'key' | 'name' | 'brand' | 'sizeText' | 'ean' | 'image' | 'offers'>;

export interface CartItem {
  id: string;
  product: CartProduct;
  qty: number;
  mode: HuntMode;
  hunt: Hunt;
  /** Offer id the user picked per chain (overrides the automatic pick). */
  choice: Partial<Record<ChainId, string>>;
  addedAt: number;
}

export type Cap = 1 | 2 | 3 | 0; // 0 = no limit

export interface Settings {
  liveKey: string;
  demo: boolean;
  chains: ChainId[];
  cap: Cap;
  extraStoreCents: number;
}

export interface Saving {
  id: string;
  date: string;
  cents: number;
  stores: number;
  /** Cart fingerprint, so the same plan is not counted twice. */
  signature: string;
}

export interface State {
  v: 2;
  cart: CartItem[];
  settings: Settings;
  recent: string[];
  savings: Saving[];
}

export const DEFAULT_SETTINGS: Settings = { liveKey: '', demo: false, chains: [...CHAIN_IDS], cap: 2, extraStoreCents: 0 };

const initial = (): State => ({ v: 2, cart: [], settings: { ...DEFAULT_SETTINGS }, recent: [], savings: [] });

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return initial();
    const s = JSON.parse(raw) as Partial<State>;
    if (s.v !== 2) return initial();
    const settings = { ...DEFAULT_SETTINGS, ...(s.settings ?? {}) };
    settings.chains = (settings.chains ?? []).filter((c) => (CHAIN_IDS as readonly string[]).includes(c));
    if (!settings.chains.length) settings.chains = [...CHAIN_IDS];
    return {
      v: 2,
      cart: Array.isArray(s.cart) ? s.cart.filter((i) => i && i.id && i.product) : [],
      settings,
      recent: Array.isArray(s.recent) ? s.recent.filter((r) => typeof r === 'string').slice(0, 8) : [],
      savings: Array.isArray(s.savings) ? s.savings : [],
    };
  } catch {
    return initial();
  }
}

/** Drops inline images from hunt candidates: they are the heaviest part and only decorative. */
function slim(s: State): State {
  const strip = <T extends Offer>(o: T): T => (o.image?.startsWith('data:') ? { ...o, image: null } : o);
  return {
    ...s,
    cart: s.cart.map((i) => ({
      ...i,
      hunt: {
        ...i.hunt,
        chains: Object.fromEntries(
          Object.entries(i.hunt.chains).map(([c, h]) => [c, h && { ...h, candidates: h.candidates.map(strip), pick: h.pick && strip(h.pick) }]),
        ),
      },
    })),
  };
}

let state: State = typeof localStorage === 'undefined' ? initial() : load();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function persist() {
  saveTimer = null;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim(state)));
    } catch {
      /* storage full or blocked: the app keeps working in memory */
    }
  }
}

export function getState(): State {
  return state;
}

export function setState(update: (s: State) => State) {
  const next = update(state);
  if (next === state) return;
  state = next;
  listeners.forEach((l) => l());
  if (!saveTimer) saveTimer = setTimeout(persist, 120);
}

/** The item whose hunt this tab is running right now (set by hunt.ts). */
let runningHere: () => string | null = () => null;

/** Lets the hunt queue say which item it is running, so another tab's copy never overwrites it. */
export function setRunningHere(fn: () => string | null) {
  runningHere = fn;
}

/**
 * Another tab's state, minus its copy of the hunt this tab is running: that copy is older
 * than ours (it only knows what we last saved). It wins only when the other tab acted on
 * that hunt: it cancelled it or queued it again (a new queuedAt).
 */
export function mergeIncoming(local: State, incoming: State, runningId: string | null): State {
  if (!runningId) return incoming;
  const mine = local.cart.find((i) => i.id === runningId);
  const theirs = incoming.cart.find((i) => i.id === runningId);
  if (!mine || !theirs || mine.hunt.status !== 'running') return incoming;
  if (theirs.hunt.queuedAt !== mine.hunt.queuedAt || theirs.hunt.status === 'cancelled') return incoming;
  return { ...incoming, cart: incoming.cart.map((i) => (i.id === runningId ? { ...i, hunt: mine.hunt, choice: mine.choice } : i)) };
}

/** The browser window, typed loosely so this module also typechecks (and runs) in the tests. */
const win = (globalThis as { window?: { addEventListener(type: string, fn: (e: { key: string | null }) => void): void } }).window;

if (win) {
  win.addEventListener('pagehide', () => saveTimer && persist());
  // Another tab changed the cart: follow it.
  win.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    state = mergeIncoming(state, load(), runningHere());
    listeners.forEach((l) => l());
  });
}

/** Calls `l` after every change of state (this tab's or another tab's). */
export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStore<T>(select: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => select(state));
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export const updateItem = (id: string, fn: (i: CartItem) => CartItem) =>
  setState((s) => ({ ...s, cart: s.cart.map((i) => (i.id === id ? fn(i) : i)) }));

export const updateSettings = (patch: Partial<Settings>) => setState((s) => ({ ...s, settings: { ...s.settings, ...patch } }));

export function addRecent(q: string) {
  const t = q.trim();
  if (!t) return;
  setState((s) => ({ ...s, recent: [t, ...s.recent.filter((r) => r.toLowerCase() !== t.toLowerCase())].slice(0, 8) }));
}

export const clearRecent = () => setState((s) => ({ ...s, recent: [] }));

export const clampQty = (n: number) => Math.max(1, Math.min(99, Math.round(Number.isFinite(n) ? n : 1)));

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
