/**
 * Where to buy each item of a cart.
 *
 * `prices` is every known price: product -> chain -> cents. The plan picks, for
 * a set of chains, the cheapest chain that has each item; it tries every set of
 * at most `maxStores` chains and keeps the cheapest that covers the most items.
 * Carts are small and chains are few (≤ 7), so trying every set is exact and fast.
 */
export type Prices = Record<string, Record<string, number>>;
export interface CartItem { ean: string; qty: number }
export interface Stop { chain: string; items: Array<{ ean: string; qty: number; unitCents: number; totalCents: number }>; totalCents: number }
export interface Plan { stops: Stop[]; totalCents: number; missing: string[] }
export interface Checkout {
  best: Plan;
  /** The cheapest single chain that has every item, if any chain does. */
  bestSingle: { chain: string; totalCents: number } | null;
  /** best single minus best plan; null when no single chain has everything. */
  savingsCents: number | null;
}

function subsets<T>(xs: T[], max: number): T[][] {
  const out: T[][] = [];
  const walk = (start: number, acc: T[]) => {
    if (acc.length) out.push([...acc]);
    if (acc.length === max) return;
    for (let i = start; i < xs.length; i++) { acc.push(xs[i]!); walk(i + 1, acc); acc.pop(); }
  };
  walk(0, []);
  return out;
}

export function planFor(cart: CartItem[], prices: Prices, chains: string[]): Plan {
  const byChain = new Map<string, Stop>();
  const missing: string[] = [];
  for (const item of cart) {
    let bestChain: string | null = null;
    let bestCents = Infinity;
    for (const c of chains) {
      const cents = prices[item.ean]?.[c];
      if (cents !== undefined && (cents < bestCents || (cents === bestCents && bestChain !== null && c < bestChain))) { bestChain = c; bestCents = cents; }
    }
    if (bestChain === null) { missing.push(item.ean); continue; }
    const stop = byChain.get(bestChain) ?? { chain: bestChain, items: [], totalCents: 0 };
    stop.items.push({ ean: item.ean, qty: item.qty, unitCents: bestCents, totalCents: bestCents * item.qty });
    stop.totalCents += bestCents * item.qty;
    byChain.set(bestChain, stop);
  }
  const stops = [...byChain.values()].sort((a, b) => b.totalCents - a.totalCents || a.chain.localeCompare(b.chain));
  return { stops, totalCents: stops.reduce((s, x) => s + x.totalCents, 0), missing };
}

export function checkout(cart: CartItem[], prices: Prices, maxStores = Infinity): Checkout {
  const items = cart.filter((i) => i.qty > 0);
  const chains = [...new Set(items.flatMap((i) => Object.keys(prices[i.ean] ?? {})))].sort();
  let best: Plan = { stops: [], totalCents: 0, missing: items.map((i) => i.ean) };
  for (const set of subsets(chains, Math.max(1, Math.min(maxStores, chains.length)))) {
    const p = planFor(items, prices, set);
    if (p.missing.length < best.missing.length
      || (p.missing.length === best.missing.length && (p.totalCents < best.totalCents
        || (p.totalCents === best.totalCents && p.stops.length < best.stops.length)))) best = p;
  }
  let bestSingle: Checkout['bestSingle'] = null;
  for (const c of chains) {
    const p = planFor(items, prices, [c]);
    if (!p.missing.length && (!bestSingle || p.totalCents < bestSingle.totalCents)) bestSingle = { chain: c, totalCents: p.totalCents };
  }
  return { best, bestSingle, savingsCents: bestSingle && !best.missing.length ? bestSingle.totalCents - best.totalCents : null };
}
