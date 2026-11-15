import { describe, expect, it } from 'vitest';
import { costFor, wantedSize } from '../src/shared/equiv';
import { optimise, type PlanItem, type PlanResult } from '../src/shared/optimize';
import { CHAIN_IDS, type ChainId, type Offer } from '../src/shared/types';

function offer(chain: ChainId, priceCents: number, sizeText: string | null = '1 L', extra: Partial<Offer> = {}): Offer {
  return {
    chain,
    id: `${chain}-${priceCents}-${sizeText}`,
    name: 'x',
    brand: null,
    ean: null,
    sizeText,
    priceCents,
    unitPriceCents: null,
    unit: null,
    image: null,
    url: null,
    promo: null,
    source: 'live',
    observedOn: '2026-11-15',
    ...extra,
  };
}

/** prices: chain -> cents (1 L packs unless a size is given as [cents, size]). */
function item(id: string, qty: number, prices: Partial<Record<ChainId, number | [number, string | null]>>, sizeText: string | null = '1 L'): PlanItem {
  const offers: Partial<Record<ChainId, Offer>> = {};
  for (const [chain, p] of Object.entries(prices) as Array<[ChainId, number | [number, string | null]]>) {
    offers[chain] = Array.isArray(p) ? offer(chain, p[0], p[1]) : offer(chain, p);
  }
  return { id, name: id.charAt(0).toUpperCase() + id.slice(1), qty, wanted: { name: id, brand: null, sizeText, ean: null }, offers };
}

const chainsOf = (p: PlanResult) => p.stops.map((s) => s.chain).sort();

const cart = [
  item('leche', 2, { aldi: 100, carrefour: 90, mercadona: 120 }),
  item('pan', 1, { aldi: 200, carrefour: 250, mercadona: 150 }),
  item('cafe', 1, { aldi: 500, mercadona: 450 }),
];

describe('optimise', () => {
  it('buys each item where it is cheapest when stores are unlimited', () => {
    const r = optimise(cart);
    expect(r.split.totalCents).toBe(90 * 2 + 150 + 450);
    expect(chainsOf(r.split)).toEqual(['carrefour', 'mercadona']);
    expect(r.split.stores).toBe(2);
    expect(r.split.missing).toEqual([]);
    expect(r.bestSingle).toMatchObject({ chain: 'mercadona', totalCents: 120 * 2 + 150 + 450 });
    expect(r.savingCents).toBe(240 + 150 + 450 - (180 + 150 + 450));
  });

  it('fills each stop with its lines, packs and costs, biggest stop first', () => {
    const r = optimise(cart);
    expect(r.split.stops[0]!.chain).toBe('mercadona');
    expect(r.split.stops[0]!.lines.map((l) => [l.itemId, l.name, l.packs, l.costCents])).toEqual([
      ['pan', 'Pan', 1, 150],
      ['cafe', 'Cafe', 1, 450],
    ]);
    expect(r.split.stops[1]!.lines[0]).toMatchObject({ itemId: 'leche', packs: 2, costCents: 180, leftover: null });
    for (const plan of [r.split, ...Object.values(r.byCap)]) {
      expect(plan.totalCents).toBe(plan.stops.reduce((s, x) => s + x.totalCents, 0));
      for (const stop of plan.stops) expect(stop.totalCents).toBe(stop.lines.reduce((s, l) => s + l.costCents, 0));
    }
  });

  it('with one store allowed picks the cheapest single store', () => {
    const r = optimise(cart, { cap: 1 });
    expect(r.split.stores).toBe(1);
    expect(r.split.totalCents).toBe(r.bestSingle!.totalCents);
    expect(r.savingCents).toBe(0);
    expect(r.byCap[1]).toEqual(r.split);
  });

  it('gives a plan per cap', () => {
    const r = optimise(cart);
    expect(r.byCap[1].stores).toBe(1);
    expect(r.byCap[2].stores).toBe(2);
    expect(r.byCap[3]).toEqual(r.byCap[2]);
    expect(r.byCap.all).toEqual(r.split);
    expect(r.byCap[1].totalCents).toBeGreaterThanOrEqual(r.byCap[2].totalCents);
  });

  it('covers as many items as possible before it looks at price', () => {
    const items = [item('cafe', 1, { aldi: 500, mercadona: 450 }), item('nocilla', 1, { carrefour: 300 })];
    const one = optimise(items, { cap: 1 });
    expect(one.split.missing).toHaveLength(1);
    expect(one.bestSingle).toBeNull();
    expect(one.savingCents).toBeNull();
    const two = optimise(items, { cap: 2 });
    expect(two.split.missing).toEqual([]);
    expect(two.split.totalCents).toBe(750);
    expect(two.savingCents).toBeNull();
  });

  it('covers first even when the extra store cost is high', () => {
    const items = [item('cafe', 1, { mercadona: 450 }), item('nocilla', 1, { carrefour: 300 })];
    const r = optimise(items, { extraStoreCents: 100_000 });
    expect(r.split.missing).toEqual([]);
    expect(r.split.stores).toBe(2);
  });

  // Regression (shared-7): one item priced nowhere used to null bestSingle and
  // savingCents, while the split tip still claimed a saving against one store.
  it('reports items that no chain prices and still compares the chains on the rest', () => {
    const items = [...cart, item('caviar', 1, {})];
    const r = optimise(items);
    expect(r.split.missing).toEqual(['caviar']);
    expect(r.split.totalCents).toBe(180 + 150 + 450);
    expect(r.bestSingle).toMatchObject({ chain: 'mercadona', totalCents: 240 + 150 + 450, missing: ['caviar'] });
    expect(r.savingCents).toBe(240 - 180);
    expect(r.byCap[1].missing).toEqual(['caviar']);
  });

  it('has no single store to compare when no chain has every priced item', () => {
    const r = optimise([item('a', 1, { aldi: 100 }), item('b', 1, { lidl: 100 }), item('c', 1, {})]);
    expect(r.bestSingle).toBeNull();
    expect(r.savingCents).toBeNull();
    const none = optimise([item('c', 1, {})]);
    expect(none.bestSingle).toBeNull();
    expect(none.savingCents).toBeNull();
  });

  it('lets the extra-store cost flip the decision', () => {
    // Splitting saves 100 cents over Mercadona alone.
    const items = [item('leche', 1, { mercadona: 150, aldi: 50 }), item('pan', 1, { mercadona: 100, aldi: 300 })];
    const cheap = optimise(items, { extraStoreCents: 50 });
    expect(cheap.split.stores).toBe(2);
    expect(cheap.split.totalCents).toBe(150);
    expect(cheap.savingCents).toBe(100);
    const dear = optimise(items, { extraStoreCents: 150 });
    expect(dear.split.stores).toBe(1);
    expect(dear.split.totalCents).toBe(250);
    expect(chainsOf(dear.split)).toEqual(['mercadona']);
    expect(dear.savingCents).toBe(0);
    expect(dear.byCap.all.stores).toBe(1);
    expect(dear.byCap[3].stores).toBe(1);
    // At exactly the saving it is a tie: fewer stores wins.
    expect(optimise(items, { extraStoreCents: 100 }).split.stores).toBe(1);
  });

  it('breaks ties by fewer stores, then by chain id', () => {
    const same = [item('leche', 1, { mercadona: 100, aldi: 100 }), item('pan', 1, { mercadona: 200, aldi: 200 })];
    const r = optimise(same);
    expect(r.split.stores).toBe(1);
    expect(chainsOf(r.split)).toEqual(['aldi']);
    expect(r.bestSingle!.chain).toBe('aldi');
    expect(r.singles.map((s) => s.chain).slice(0, 2)).toEqual(['aldi', 'mercadona']);
    // Same total split two ways or kept in one store: one store.
    const mixed = [item('leche', 1, { mercadona: 100, aldi: 100 }), item('pan', 1, { mercadona: 200, lidl: 200 })];
    expect(optimise(mixed).split.stores).toBe(1);
    expect(chainsOf(optimise(mixed).split)).toEqual(['mercadona']);
  });

  it('treats a cap larger than the chains as no cap, and a cap below 1 as 1', () => {
    expect(optimise(cart, { cap: 99 }).split).toEqual(optimise(cart).split);
    expect(optimise(cart, { cap: Number.POSITIVE_INFINITY }).split).toEqual(optimise(cart).split);
    expect(optimise(cart, { cap: Number.NaN }).split).toEqual(optimise(cart).split);
    expect(optimise(cart, { cap: 0 }).split.stores).toBe(1);
    expect(optimise(cart, { cap: -3 }).split.stores).toBe(1);
    expect(optimise(cart, { cap: 1.9 }).split.stores).toBe(1);
  });

  it('lists every considered chain as a single, full coverage first', () => {
    const r = optimise(cart);
    expect(r.singles).toHaveLength(CHAIN_IDS.length);
    expect(r.singles.map((s) => s.chain).slice(0, 3)).toEqual(['mercadona', 'aldi', 'carrefour']);
    expect(r.singles[2]!.missing).toEqual(['cafe']);
    const empty = r.singles.find((s) => s.chain === 'lidl')!;
    expect(empty).toMatchObject({ stops: [], totalCents: 0, stores: 0, missing: ['leche', 'pan', 'cafe'] });
    for (const s of r.singles) expect(s.stores).toBeLessThanOrEqual(1);
  });

  it('only uses the chains it is given', () => {
    const r = optimise(cart, { chains: ['aldi', 'carrefour'] });
    expect(r.singles.map((s) => s.chain).sort()).toEqual(['aldi', 'carrefour']);
    expect(chainsOf(r.split)).toEqual(['aldi', 'carrefour']);
    expect(r.split.totalCents).toBe(180 + 200 + 500);
    expect(r.bestSingle!.chain).toBe('aldi');
  });

  it('copes with an empty cart and with no offers at all', () => {
    const empty = optimise([]);
    expect(empty.split).toEqual({ stops: [], totalCents: 0, missing: [], stores: 0 });
    expect(empty.bestSingle).toBeNull();
    expect(empty.savingCents).toBeNull();
    expect(empty.byCap.all.stores).toBe(0);

    const none = optimise([item('leche', 1, {}), item('pan', 2, {})]);
    expect(none.split.missing).toEqual(['leche', 'pan']);
    expect(none.split.stores).toBe(0);
    expect(none.bestSingle).toBeNull();
    expect(none.savingCents).toBeNull();
    expect(none.singles.every((s) => s.missing.length === 2)).toBe(true);
  });

  it('leaves out items with no quantity and offers without a valid price', () => {
    const items = [item('leche', 0, { aldi: 100 }), item('pan', 1, { aldi: Number.NaN, lidl: 0, mercadona: 150 })];
    const r = optimise(items);
    expect(r.split.missing).toEqual([]);
    expect(r.split.stops.flatMap((s) => s.lines.map((l) => l.itemId))).toEqual(['pan']);
    expect(chainsOf(r.split)).toEqual(['mercadona']);
  });

  it('costs whole packs: a 6-pack wins only when you need enough of it', () => {
    const prices = { aldi: [474, '6 x 1 L'] as [number, string], mercadona: 100 };
    const few = optimise([item('leche', 2, prices)]);
    expect(few.split.stops[0]!.chain).toBe('mercadona');
    expect(few.split.totalCents).toBe(200);
    const many = optimise([item('leche', 6, prices)]);
    expect(many.split.stops[0]!.chain).toBe('aldi');
    expect(many.split.stops[0]!.lines[0]).toMatchObject({ packs: 1, costCents: 474, leftover: null });
    const some = optimise([item('leche', 5, prices)]);
    expect(some.split.stops[0]!.lines[0]).toMatchObject({ packs: 1, costCents: 474, leftover: { count: 1, amount: 1000, unit: 'ml' } });
  });

  // Regression (shared-1): 800 g bags used to count as 1 kg each, so the plan
  // bought 4 kg for 5 kg and sent the item to the dearer-per-kilo chain.
  it('never counts a smaller pack as a whole wanted unit', () => {
    const r = optimise([item('arroz', 5, { aldi: [100, '800 g'], lidl: [110, '1 kg'] }, '1 kg')]);
    expect(r.split.stops.map((s) => s.chain)).toEqual(['lidl']);
    expect(r.split.totalCents).toBe(550);
    expect(r.singles.find((s) => s.chain === 'aldi')).toMatchObject({ totalCents: 700 });
    expect(r.singles.find((s) => s.chain === 'aldi')!.stops[0]!.lines[0]).toMatchObject({ packs: 7, costCents: 700 });
  });

  it('falls back to qty packs when sizes are unknown', () => {
    const r = optimise([item('fruta', 3, { aldi: [200, null], lidl: [250, null] }, null)]);
    expect(r.split.totalCents).toBe(600);
    expect(r.split.stops[0]!.lines[0]!.packs).toBe(3);
  });

  it('handles all eight chains at once', () => {
    const prices = Object.fromEntries(CHAIN_IDS.map((c, i) => [c, 100 + i])) as Record<ChainId, number>;
    const items = CHAIN_IDS.map((c, i) => item(`i${i}`, 1, { ...prices, [c]: 50 }));
    const r = optimise(items);
    expect(r.split.stores).toBe(8);
    expect(r.split.totalCents).toBe(8 * 50);
    expect(r.byCap[3].stores).toBe(3);
    expect(r.savingCents).toBe(r.bestSingle!.totalCents - 400);
  });
});

// ---------------------------------------------------------------------------
// Exactness: compare with brute force over every assignment of items to chains.
// ---------------------------------------------------------------------------

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

function brute(items: PlanItem[], cap: number, extra: number): { covered: number; objective: number } {
  const options = items.map((it) => {
    const size = wantedSize(it.wanted);
    const opts: Array<{ chain: ChainId | null; cents: number }> = [{ chain: null, cents: 0 }];
    for (const [chain, o] of Object.entries(it.offers) as Array<[ChainId, Offer]>) opts.push({ chain, cents: costFor(o, size, it.qty).cents });
    return opts;
  });
  let best = { covered: -1, objective: Infinity };
  const walk = (i: number, chains: Set<ChainId>, covered: number, total: number) => {
    if (chains.size > cap) return;
    if (i === items.length) {
      const objective = total + Math.max(0, chains.size - 1) * extra;
      if (covered > best.covered || (covered === best.covered && objective < best.objective)) best = { covered, objective };
      return;
    }
    for (const o of options[i]!) {
      if (o.chain === null) walk(i + 1, chains, covered, total);
      else {
        const next = new Set(chains).add(o.chain);
        walk(i + 1, next, covered + 1, total + o.cents);
      }
    }
  };
  walk(0, new Set(), 0, 0);
  return best;
}

describe('optimise is exact', () => {
  it('matches brute force on random carts, caps and extra-store costs', () => {
    const rand = rng(42);
    const pool: ChainId[] = ['mercadona', 'aldi', 'lidl', 'carrefour', 'bm'];
    const sizes = ['1 L', '6 x 1 L', '500 ml', null];
    for (let round = 0; round < 60; round++) {
      const nItems = 1 + Math.floor(rand() * 5);
      const items: PlanItem[] = [];
      for (let i = 0; i < nItems; i++) {
        const prices: Partial<Record<ChainId, [number, string | null]>> = {};
        for (const c of pool) if (rand() < 0.6) prices[c] = [50 + Math.floor(rand() * 500), sizes[Math.floor(rand() * sizes.length)]!];
        items.push(item(`i${i}`, 1 + Math.floor(rand() * 4), prices));
      }
      const extra = [0, 50, 200][Math.floor(rand() * 3)]!;
      const r = optimise(items, { extraStoreCents: extra });
      for (const [cap, plan] of [[1, r.byCap[1]], [2, r.byCap[2]], [3, r.byCap[3]], [99, r.byCap.all]] as const) {
        const b = brute(items, cap, extra);
        expect(nItems - plan.missing.length).toBe(b.covered);
        expect(plan.totalCents + Math.max(0, plan.stores - 1) * extra).toBe(b.objective);
        expect(plan.stores).toBeLessThanOrEqual(cap);
      }
      if (r.savingCents !== null) expect(r.savingCents).toBeGreaterThanOrEqual(0);
    }
  });
});
