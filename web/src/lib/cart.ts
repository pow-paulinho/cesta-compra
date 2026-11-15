/** Cart helpers: the offer used per chain, plan items, best price per item. */
import type { Candidate, ChainId, Offer, WantedProduct } from '@shared/types';
import { costFor, pickBest, wantedSize } from '@shared/equiv';
import type { PlanItem } from '@shared/optimize';
import type { CartItem, Settings } from './store';

export const wantedOf = (i: CartItem): WantedProduct => ({
  name: i.product.name,
  brand: i.product.brand,
  sizeText: i.product.sizeText,
  ean: i.product.ean,
});

/**
 * The offer an item uses at a chain: the user's choice, else the best pick for
 * the quantity, else (before the hunt answers) the cheapest price known from the search.
 */
export function chainOffer(item: CartItem, chain: ChainId, settings: Pick<Settings, 'demo'>): Offer | Candidate | null {
  const h = item.hunt.chains[chain];
  if (h && h.status !== 'pending') {
    const chosen = item.choice[chain];
    if (chosen) {
      const c = h.candidates.find((x) => x.id === chosen);
      if (c) return c;
    }
    return pickBest(h.candidates, item.mode, wantedOf(item), item.qty) ?? h.pick;
  }
  const known = item.product.offers
    .filter((o) => o.chain === chain && o.priceCents > 0 && (settings.demo || o.source !== 'demo'))
    .sort((a, b) => a.priceCents - b.priceCents);
  return known[0] ?? null;
}

export function toPlanItems(cart: CartItem[], settings: Pick<Settings, 'demo' | 'chains'>): PlanItem[] {
  return cart.map((i) => {
    const offers: PlanItem['offers'] = {};
    for (const c of settings.chains) {
      const o = chainOffer(i, c, settings);
      if (o) offers[c] = o;
    }
    return { id: i.id, name: i.product.name, qty: i.qty, wanted: wantedOf(i), offers };
  });
}

export interface BestPrice {
  chain: ChainId;
  offer: Offer;
  cents: number;
  packs: number;
}

/** Cheapest chain for one item, for the quantity wanted. */
export function bestPrice(item: CartItem, settings: Pick<Settings, 'demo' | 'chains'>): BestPrice | null {
  const size = wantedSize(wantedOf(item));
  let best: BestPrice | null = null;
  for (const c of settings.chains) {
    const o = chainOffer(item, c, settings);
    if (!o) continue;
    const { cents, packs } = costFor(o, size, item.qty);
    if (!best || cents < best.cents) best = { chain: c, offer: o, cents, packs };
  }
  return best;
}

/** A short fingerprint of what the plan buys, to avoid logging the same saving twice. */
export function cartSignature(cart: CartItem[]): string {
  return cart
    .map((i) => `${i.product.key}x${i.qty}`)
    .sort()
    .join('|');
}
