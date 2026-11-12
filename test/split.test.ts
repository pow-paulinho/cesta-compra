import { describe, expect, it } from 'vitest';
import { checkout, planFor, type Prices } from '../src/split';

const prices: Prices = {
  leche: { A: 100, B: 90, C: 120 },
  pan: { A: 200, B: 250, C: 150 },
  cafe: { A: 500, C: 450 },
  nocilla: { B: 300 },
};

describe('split', () => {
  it('buys each item where it is cheapest when stops are unlimited', () => {
    const r = checkout([{ ean: 'leche', qty: 2 }, { ean: 'pan', qty: 1 }, { ean: 'cafe', qty: 1 }], prices);
    expect(r.best.totalCents).toBe(90 * 2 + 150 + 450);
    expect(r.best.stops.map((s) => s.chain).sort()).toEqual(['B', 'C']);
    expect(r.bestSingle).toEqual({ chain: 'C', totalCents: 120 * 2 + 150 + 450 });
    expect(r.savingsCents).toBe(240 + 150 + 450 - (180 + 150 + 450));
  });

  it('with one store allowed, picks the cheapest single store', () => {
    const r = checkout([{ ean: 'leche', qty: 2 }, { ean: 'pan', qty: 1 }, { ean: 'cafe', qty: 1 }], prices, 1);
    expect(r.best.stops).toHaveLength(1);
    expect(r.best.totalCents).toBe(r.bestSingle!.totalCents);
    expect(r.savingsCents).toBe(0);
  });

  it('covers as many items as possible before it looks at price', () => {
    const r = checkout([{ ean: 'cafe', qty: 1 }, { ean: 'nocilla', qty: 1 }], prices, 1);
    expect(r.best.missing).toHaveLength(1);
    const two = checkout([{ ean: 'cafe', qty: 1 }, { ean: 'nocilla', qty: 1 }], prices, 2);
    expect(two.best.missing).toEqual([]);
    expect(two.bestSingle).toBeNull();
    expect(two.savingsCents).toBeNull();
  });

  it('reports what no store has', () => {
    const p = planFor([{ ean: 'caviar', qty: 1 }], prices, ['A', 'B', 'C']);
    expect(p.missing).toEqual(['caviar']);
    expect(p.totalCents).toBe(0);
  });
});
