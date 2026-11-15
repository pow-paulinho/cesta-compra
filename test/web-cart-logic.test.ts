/**
 * The cart's pure helpers (web/src/lib/cart.ts) and the store's tab merge: demo and Open
 * Prices never mix (also in hunt answers), what a substitute changes, and another tab's
 * copy of a running hunt never overwrites the tab that runs it.
 */
import { describe, expect, it, vi } from 'vitest';

// The web app resolves @shared/* through Vite's alias; vitest has no config for it.
vi.mock('@shared/units', () => import('../src/shared/units'));
vi.mock('@shared/chains', () => import('../src/shared/chains'));
vi.mock('@shared/equiv', () => import('../src/shared/equiv'));
vi.mock('@shared/types', () => import('../src/shared/types'));

import type { Candidate, ChainId, Offer, OfferSource } from '../src/shared/types';
import type { CartItem, State } from '../web/src/lib/store';

const { bestPrice, chainOffer, substituteNote, toPlanItems, traitChanges } = await import('../web/src/lib/cart');
const { mergeIncoming } = await import('../web/src/lib/store');

const offer = (chain: ChainId, id: string, name: string, priceCents: number, source: OfferSource, extra: Partial<Offer> = {}): Offer => ({
  chain,
  id,
  name,
  brand: null,
  ean: null,
  sizeText: '1 L',
  priceCents,
  unitPriceCents: null,
  unit: null,
  image: null,
  url: null,
  promo: null,
  source,
  observedOn: '2026-11-01',
  ...extra,
});

const cand = (o: Offer, kind: Candidate['kind'] = 'exact', score = 0.95): Candidate => ({ ...o, kind, score });

function item(over: Partial<CartItem> = {}): CartItem {
  return {
    id: 'a',
    product: { key: 'ean:1', name: 'Leche semidesnatada Pascual', brand: 'Pascual', sizeText: '1 L', ean: null, image: null, offers: [] },
    qty: 1,
    mode: 'equivalent',
    hunt: { status: 'done', chains: {}, queuedAt: 1 },
    choice: {},
    addedAt: 0,
    ...over,
  };
}

const REAL = { demo: false, chains: ['carrefour', 'lidl'] as ChainId[] };
const DEMO = { demo: true, chains: ['carrefour', 'lidl'] as ChainId[] };

describe('chainOffer never mixes demo and Open Prices', () => {
  const op = cand(offer('carrefour', 'op', 'Leche semidesnatada Pascual', 121, 'open_prices'));
  const demo = cand(offer('carrefour', 'dm', 'Leche semidesnatada Pascual', 99, 'demo'));
  const live = cand(offer('lidl', 'lv', 'Leche semidesnatada Pascual', 110, 'live'));

  it('drops hunt candidates and picks of the other mode', () => {
    const i = item({ hunt: { status: 'done', queuedAt: 1, demo: false, chains: { carrefour: { status: 'ok', candidates: [op], pick: op } } } });
    expect(chainOffer(i, 'carrefour', REAL)?.id).toBe('op');
    // Same answer, demo now on: the Open Prices price does not count.
    expect(chainOffer(i, 'carrefour', DEMO)).toBeNull();
  });

  it('ignores a manual choice that does not count in this mode', () => {
    const i = item({ choice: { carrefour: 'dm' }, hunt: { status: 'done', queuedAt: 1, demo: false, chains: { carrefour: { status: 'ok', candidates: [op, demo], pick: op } } } });
    expect(chainOffer(i, 'carrefour', REAL)?.id).toBe('op');
  });

  it('keeps live prices in both modes', () => {
    const i = item({ hunt: { status: 'done', queuedAt: 1, demo: false, chains: { lidl: { status: 'ok', candidates: [live], pick: live } } } });
    expect(chainOffer(i, 'lidl', DEMO)?.id).toBe('lv');
  });

  it('falls back to the search prices of this mode while a hunt from the other mode is stale', () => {
    const searchDemo = offer('carrefour', 'sd', 'Leche semidesnatada Pascual', 95, 'demo');
    const i = item({
      product: { ...item().product, offers: [searchDemo, offer('carrefour', 'so', 'x', 50, 'open_prices')] },
      hunt: { status: 'done', queuedAt: 1, demo: false, chains: { carrefour: { status: 'ok', candidates: [op], pick: op } } },
    });
    expect(chainOffer(i, 'carrefour', DEMO)?.id).toBe('sd');
  });

  it('a plan never holds a demo line and an Open Prices line together', () => {
    const leche = item({ id: 'l', hunt: { status: 'done', queuedAt: 1, demo: false, chains: { carrefour: { status: 'ok', candidates: [op], pick: op } } } });
    const aceite = item({
      id: 'o',
      product: { ...item().product, key: 'ean:2', name: 'Aceite' },
      hunt: { status: 'done', queuedAt: 1, demo: true, chains: { lidl: { status: 'ok', candidates: [cand(offer('lidl', 'ad', 'Aceite', 835, 'demo'))], pick: null } } },
    });
    for (const s of [REAL, DEMO]) {
      const sources = toPlanItems([leche, aceite], s).flatMap((p) => Object.values(p.offers).map((o) => o!.source));
      expect(sources.includes('demo') && sources.includes('open_prices')).toBe(false);
    }
    expect(bestPrice(aceite, REAL)).toBeNull();
  });
});

describe('substitutes', () => {
  it('names the product it priced when it is another one', () => {
    const hac = cand(offer('mercadona', 'h', 'Leche semidesnatada Hacendado', 89, 'open_prices', { brand: 'Hacendado' }), 'equivalent', 0.8);
    const note = substituteNote(item(), hac);
    expect(note).toEqual({ name: 'Leche semidesnatada Hacendado · 1 L', ownBrand: 'marca blanca de Mercadona', changes: [] });
    expect(substituteNote(item(), cand(offer('carrefour', 'p', 'Leche semidesnatada Pascual', 121, 'open_prices')))).toBeNull();
    expect(substituteNote(item(), offer('carrefour', 'p', 'Leche', 121, 'open_prices'))).toBeNull();
  });

  it('says what a substitute changes', () => {
    expect(traitChanges({ name: 'Huevos frescos L Pazo de Vilane', sizeText: '12 ud' }, { name: 'Huevos frescos M Milsani', sizeText: '6 ud' })).toEqual(['talla M en vez de L']);
    expect(traitChanges({ name: 'Huevos camperos XL' }, { name: 'Huevos camperos talla L' })).toEqual(['talla L en vez de XL']);
    expect(traitChanges({ name: 'Leche sin lactosa semidesnatada' }, { name: 'Leche semidesnatada' })).toEqual(['no es sin lactosa']);
    expect(traitChanges({ name: 'Leche entera' }, { name: 'Leche semidesnatada' })).toEqual(['semidesnatada en vez de entera']);
    expect(traitChanges({ name: 'Leche desnatada' }, { name: 'Leche semidesnatada' })).toEqual(['semidesnatada en vez de desnatada']);
    expect(traitChanges({ name: 'Aceite de oliva virgen extra' }, { name: 'Aceite de oliva virgen' })).toEqual(['virgen en vez de virgen extra']);
    expect(traitChanges({ name: 'Agua mineral' }, { name: 'Agua mineral con gas' })).toEqual([]);
    expect(traitChanges({ name: 'Leche semidesnatada 1 L' }, { name: 'Leche semidesnatada Hacendado 1 L' })).toEqual([]);
    // "L" of litres is not an egg size.
    expect(traitChanges({ name: 'Leche entera', sizeText: '1 L' }, { name: 'Leche entera', sizeText: '1,5 L' })).toEqual([]);
  });
});

describe("another tab's state", () => {
  const running = item({ id: 'r', qty: 1, hunt: { status: 'running', queuedAt: 5, chains: { lidl: { status: 'ok', candidates: [], pick: null }, carrefour: { status: 'pending', candidates: [], pick: null } } } });
  const state = (cart: CartItem[]): State => ({ v: 2, cart, settings: { liveKey: '', demo: false, chains: ['lidl', 'carrefour'], cap: 2, extraStoreCents: 0 }, recent: [], savings: [] });
  const stale = { ...running, qty: 3, hunt: { ...running.hunt, chains: { carrefour: { status: 'pending' as const, candidates: [], pick: null } } } };

  it('keeps the hunt this tab is running, and takes everything else', () => {
    const merged = mergeIncoming(state([running]), state([stale]), 'r');
    expect(merged.cart[0]!.hunt).toBe(running.hunt);
    expect(merged.cart[0]!.qty).toBe(3);
  });

  it('takes the other tab’s cancel or re-queue', () => {
    const cancelled = { ...stale, hunt: { ...stale.hunt, status: 'cancelled' as const } };
    expect(mergeIncoming(state([running]), state([cancelled]), 'r').cart[0]!.hunt.status).toBe('cancelled');
    const requeued = { ...stale, hunt: { ...stale.hunt, status: 'queued' as const, queuedAt: 9 } };
    expect(mergeIncoming(state([running]), state([requeued]), 'r').cart[0]!.hunt.queuedAt).toBe(9);
    expect(mergeIncoming(state([running]), state([]), 'r').cart).toEqual([]);
    expect(mergeIncoming(state([running]), state([stale]), null).cart[0]).toBe(stale);
  });
});
