/**
 * Where to buy each item of the cart.
 *
 * Pure: no DOM, no Worker globals.
 *
 * Each item has at most one offer per chain (the hunt's pick or the user's
 * choice). The cost of an item at a chain is whole packs times the pack price
 * (see costFor). For a set of chains, every item goes to the cheapest chain of
 * the set that has it; every subset of the chains present (at most 8, so at
 * most 255 subsets) is tried, which makes the result exact. Plans are compared
 * by coverage first, then by total + (stores - 1) * extraStoreCents, then by
 * fewer stores, then by chain ids.
 */
import { CHAIN_IDS, type ChainId, type Offer, type WantedProduct } from './types';
import { costFor, wantedSize } from './equiv';
import type { Size } from './units';

export interface PlanItem {
  id: string;
  name: string;
  qty: number;
  wanted: WantedProduct;
  offers: Partial<Record<ChainId, Offer>>;
}

export interface StopLine {
  itemId: string;
  name: string;
  offer: Offer;
  packs: number;
  costCents: number;
  /** What is bought beyond the need ("te sobran 4 L"), when whole packs overshoot. */
  leftover?: Size | null;
}

export interface Stop {
  chain: ChainId;
  lines: StopLine[];
  totalCents: number;
}

export interface PlanResult {
  /** Biggest stop first. */
  stops: Stop[];
  /** Sum of the lines, without the extra-store heuristic. */
  totalCents: number;
  /** Ids of the items no chain of the plan prices, in cart order. */
  missing: string[];
  stores: number;
}

export interface Optimisation {
  /** Every chain considered, sorted: full coverage first (fewest missing), then total, then chain id. */
  singles: Array<PlanResult & { chain: ChainId }>;
  /** The cheapest chain that has every item; null when none has, or the cart is empty. */
  bestSingle: (PlanResult & { chain: ChainId }) | null;
  /** The best plan under opts.cap and opts.extraStoreCents. */
  split: PlanResult;
  byCap: { 1: PlanResult; 2: PlanResult; 3: PlanResult; all: PlanResult };
  /** bestSingle.totalCents - split.totalCents when both cover every item; else null. */
  savingCents: number | null;
}

export interface OptimiseOptions {
  /** Most stores to visit; default no limit. */
  cap?: number;
  /** Cost in cents the user puts on each stop beyond the first (time, transport). */
  extraStoreCents?: number;
  /** Only these chains (the user's active ones); default all. */
  chains?: ChainId[];
}

interface Cell {
  offer: Offer;
  packs: number;
  cents: number;
  leftover: Size | null;
}

interface Row {
  item: PlanItem;
  cells: Partial<Record<ChainId, Cell>>;
}

interface Evaluated {
  plan: PlanResult;
  /** Chains used, sorted by id. */
  used: ChainId[];
  /** Size of the subset that produced it (an upper bound on stores). */
  setSize: number;
}

const cmpId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function buildRows(items: PlanItem[], allowed: ReadonlySet<ChainId>): Row[] {
  return items
    .filter((item) => Number.isFinite(item.qty) && item.qty > 0)
    .map((item) => {
      const size = wantedSize(item.wanted);
      const cells: Partial<Record<ChainId, Cell>> = {};
      for (const chain of CHAIN_IDS) {
        const offer = item.offers[chain];
        if (!offer || !allowed.has(chain) || !Number.isFinite(offer.priceCents) || offer.priceCents <= 0) continue;
        const c = costFor(offer, size, item.qty);
        cells[chain] = { offer, packs: c.packs, cents: c.cents, leftover: c.leftover };
      }
      return { item, cells };
    });
}

/** Every item to the cheapest chain of `chains` that has it (ties: lower chain id). */
function planFor(rows: Row[], chains: readonly ChainId[]): Evaluated {
  const byChain = new Map<ChainId, Stop>();
  const missing: string[] = [];
  for (const { item, cells } of rows) {
    let best: { chain: ChainId; cell: Cell } | null = null;
    for (const chain of chains) {
      const cell = cells[chain];
      if (cell && (!best || cell.cents < best.cell.cents || (cell.cents === best.cell.cents && cmpId(chain, best.chain) < 0))) {
        best = { chain, cell };
      }
    }
    if (!best) {
      missing.push(item.id);
      continue;
    }
    const stop = byChain.get(best.chain) ?? { chain: best.chain, lines: [], totalCents: 0 };
    stop.lines.push({
      itemId: item.id,
      name: item.name,
      offer: best.cell.offer,
      packs: best.cell.packs,
      costCents: best.cell.cents,
      leftover: best.cell.leftover,
    });
    stop.totalCents += best.cell.cents;
    byChain.set(best.chain, stop);
  }
  const stops = [...byChain.values()].sort((a, b) => b.totalCents - a.totalCents || cmpId(a.chain, b.chain));
  const used = stops.map((s) => s.chain).sort(cmpId);
  return {
    plan: { stops, totalCents: stops.reduce((sum, s) => sum + s.totalCents, 0), missing, stores: stops.length },
    used,
    setSize: chains.length,
  };
}

function objective(p: PlanResult, extra: number): number {
  return p.totalCents + Math.max(0, p.stores - 1) * extra;
}

function compareIds(a: ChainId[], b: ChainId[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const c = cmpId(a[i]!, b[i]!);
    if (c) return c;
  }
  return a.length - b.length;
}

/** Negative when `a` is the better plan. */
function comparePlans(a: Evaluated, b: Evaluated, extra: number): number {
  return (
    a.plan.missing.length - b.plan.missing.length
    || objective(a.plan, extra) - objective(b.plan, extra)
    || a.plan.stores - b.plan.stores
    || compareIds(a.used, b.used)
  );
}

function subsets<T>(xs: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let mask = 1; mask < 1 << xs.length; mask++) out.push(xs.filter((_, i) => mask & (1 << i)));
  return out;
}

function normaliseCap(cap: number | undefined, n: number): number {
  if (cap === undefined || cap === null || Number.isNaN(cap)) return n;
  return Math.max(1, Math.min(n, Math.floor(cap)));
}

export function optimise(items: PlanItem[], opts: OptimiseOptions = {}): Optimisation {
  const extra = Number.isFinite(opts.extraStoreCents) ? Math.max(0, Math.round(opts.extraStoreCents!)) : 0;
  const considered = opts.chains ? CHAIN_IDS.filter((c) => opts.chains!.includes(c)) : [...CHAIN_IDS];
  const rows = buildRows(items, new Set(considered));
  const present = considered.filter((c) => rows.some((r) => r.cells[c])).sort(cmpId);

  const empty = planFor(rows, []);
  const evaluated = subsets(present).map((set) => planFor(rows, set));

  const bestUnder = (cap: number | undefined): PlanResult => {
    const limit = normaliseCap(cap, present.length);
    let best: Evaluated = empty;
    for (const e of evaluated) if (e.setSize <= limit && comparePlans(e, best, extra) < 0) best = e;
    return best.plan;
  };

  const singles = considered
    .map((chain) => ({ chain, ...planFor(rows, [chain]).plan }))
    .sort((a, b) => a.missing.length - b.missing.length || a.totalCents - b.totalCents || cmpId(a.chain, b.chain));
  const bestSingle = rows.length ? singles.find((s) => s.missing.length === 0) ?? null : null;

  const split = bestUnder(opts.cap);
  return {
    singles,
    bestSingle,
    split,
    byCap: { 1: bestUnder(1), 2: bestUnder(2), 3: bestUnder(3), all: bestUnder(undefined) },
    savingCents: bestSingle && split.missing.length === 0 ? bestSingle.totalCents - split.totalCents : null,
  };
}
