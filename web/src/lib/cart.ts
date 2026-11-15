/** Cart helpers: the offer used per chain, plan items, best price per item. */
import type { Candidate, ChainId, Offer, WantedProduct } from '@shared/types';
import { CHAINS } from '@shared/chains';
import { costFor, ownBrandOf, pickBest, wantedSize } from '@shared/equiv';
import type { PlanItem } from '@shared/optimize';
import type { CartItem, Settings } from './store';

export const wantedOf = (i: CartItem): WantedProduct => ({
  name: i.product.name,
  brand: i.product.brand,
  sizeText: i.product.sizeText,
  ean: i.product.ean,
});

/** Whether a known price counts in this mode: demo and Open Prices are never mixed, live always counts. */
export const countsInMode = (o: Pick<Offer, 'source'>, demo: boolean): boolean => o.source !== (demo ? 'open_prices' : 'demo');

/** Whether a hunt asked for the other kind of prices (demo vs Open Prices) than the app now shows. */
export const huntIsStale = (item: CartItem, settings: Pick<Settings, 'demo'>): boolean =>
  item.hunt.demo !== undefined && item.hunt.demo !== settings.demo;

/** The candidates of a hunt answer that count in this mode (demo and Open Prices never mix). */
export const usableCandidates = (candidates: Candidate[], settings: Pick<Settings, 'demo'>): Candidate[] =>
  candidates.filter((c) => countsInMode(c, settings.demo));

/**
 * The offer an item uses at a chain: the user's choice, else the best pick for
 * the quantity, else (before the hunt answers) the cheapest price known from the search.
 * A hunt answer of any status counts (a locked chain may carry the catalogue's prices).
 * Like the server, demo and Open Prices prices are never mixed: demo mode uses demo
 * prices, otherwise Open Prices; live prices count either way. That holds for hunt
 * answers too: a hunt made in the other mode only lends its live prices, and until it
 * runs again the chain falls back to the search's prices for this mode.
 */
export function chainOffer(item: CartItem, chain: ChainId, settings: Pick<Settings, 'demo'>): Offer | Candidate | null {
  const h = item.hunt.chains[chain];
  if (h && h.status !== 'pending') {
    const usable = usableCandidates(h.candidates, settings);
    const chosen = item.choice[chain];
    if (chosen) {
      const c = usable.find((x) => x.id === chosen);
      if (c) return c;
    }
    const pick = h.pick && countsInMode(h.pick, settings.demo) ? h.pick : null;
    const best = pickBest(usable, item.mode, wantedOf(item), item.qty) ?? pick;
    if (best || !huntIsStale(item, settings)) return best;
  }
  const known = item.product.offers
    .filter((o) => o.chain === chain && o.priceCents > 0 && countsInMode(o, settings.demo))
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

// ---------------------------------------------------------------------------
// Substitutes: what the cart says when the best price is another product
// ---------------------------------------------------------------------------

/** True when the offer is not the product itself (another brand, size or variant). */
export const isSubstitute = (o: Offer | Candidate): o is Candidate => 'kind' in o && o.kind !== 'exact';

type Trait = { label: string; re: RegExp };

/**
 * Traits a substitute can quietly change. A group with several values ("entera",
 * "semidesnatada") warns when both sides name a different one; a group with one value
 * ("sin lactosa") warns when only one side has it.
 */
const TRAITS: Array<{ when?: RegExp; values: Trait[] }> = [
  { when: /\bhuevos?\b/, values: ['XL', 'L', 'M', 'S'].map((t) => ({ label: `talla ${t}`, re: new RegExp(`(?:^|\\s)(?:talla\\s+)?${t.toLowerCase()}(?=\\s|$)`) })) },
  {
    values: [
      { label: 'semidesnatada', re: /\bsemi(?:desnatad[ao]|\b)/ },
      { label: 'desnatada', re: /(?<!semi)\bdesnatad[ao]|\b0\s?% m\.?g/ },
      { label: 'entera', re: /\benter[ao]\b/ },
    ],
  },
  { values: [{ label: 'virgen extra', re: /\bvirgen extra\b|\baove\b/ }, { label: 'virgen', re: /\bvirgen\b(?! extra)/ }] },
  { values: [{ label: 'sin lactosa', re: /\bsin lactosa\b|\b0\s?% lactosa/ }] },
  { values: [{ label: 'sin gluten', re: /\bsin gluten\b/ }] },
  { values: [{ label: 'sin azúcar', re: /\bsin azucar(?:es)?(?: anadidos?)?\b|\bzero\b/ }] },
  { values: [{ label: 'sin alcohol', re: /\bsin alcohol\b|\b0[,.]0\b/ }] },
  { values: [{ label: 'con gas', re: /\bcon gas\b/ }, { label: 'sin gas', re: /\bsin gas\b/ }] },
  { values: [{ label: 'descafeinado', re: /\bdescafeinad[ao]\b/ }] },
  { values: [{ label: 'integral', re: /\bintegral(?:es)?\b/ }] },
  { values: [{ label: 'ecológico', re: /\becologic[ao]s?\b|\bbio\b|\beco\b/ }] },
  { values: [{ label: 'light', re: /\blight\b/ }] },
];

/** Lower case, no accents, single spaces. */
const plain = (s: string | null | undefined) =>
  (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const textOf = (o: { name: string; brand?: string | null; sizeText?: string | null }) => plain(`${o.name} ${o.brand ?? ''} ${o.sizeText ?? ''}`);

/**
 * What a substitute changes that the user may care about, as short Spanish phrases:
 * "talla M en vez de L", "no es sin lactosa", "es semidesnatada en vez de entera".
 */
export function traitChanges(wanted: { name: string; brand?: string | null; sizeText?: string | null }, offer: { name: string; brand?: string | null; sizeText?: string | null }): string[] {
  const w = textOf(wanted);
  const o = textOf(offer);
  const out: string[] = [];
  for (const g of TRAITS) {
    if (g.when && !(g.when.test(w) && g.when.test(o))) continue;
    const wv = g.values.find((v) => v.re.test(w));
    const ov = g.values.find((v) => v.re.test(o));
    if (wv && ov && wv !== ov) {
      const short = (l: string) => (g.when ? l.replace(/^talla /, '') : l);
      out.push(`${ov.label} en vez de ${short(wv.label)}`);
    } else if (g.values.length === 1 && wv && !ov) out.push(`no es ${wv.label}`);
    else if (g.values.length === 1 && !wv && ov) out.push(`es ${ov.label}`);
  }
  return out;
}

export interface SubstituteNote {
  /** "Leche semidesnatada Hacendado · 1 L". */
  name: string;
  /** "marca blanca de Mercadona", or null. */
  ownBrand: string | null;
  /** traitChanges() for the offer. */
  changes: string[];
}

/** What the cart row says about the product it priced, when it is not the one in the cart. */
export function substituteNote(item: CartItem, offer: Offer | Candidate): SubstituteNote | null {
  if (!isSubstitute(offer)) return null;
  const own = ownBrandOf(offer);
  return {
    name: [offer.name, offer.sizeText].filter(Boolean).join(' · '),
    ownBrand: own && own.chain === offer.chain ? `marca blanca de ${CHAINS[own.chain].name}` : null,
    changes: traitChanges(item.product, offer),
  };
}
