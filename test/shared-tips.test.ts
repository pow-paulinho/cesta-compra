import { describe, expect, it } from 'vitest';
import { optimise, type PlanItem } from '../src/shared/optimize';
import { EVERGREEN_TIPS, savingTips, type Tip } from '../src/shared/tips';
import type { ChainId, Offer } from '../src/shared/types';
import { NBSP } from '../src/shared/units';

const NOW = new Date('2026-11-15T10:00:00Z');
const eur = (s: string) => s.replace(/ €/g, `${NBSP}€`).replace(/ %/g, `${NBSP}%`);

function o(chain: ChainId, name: string, brand: string | null, sizeText: string | null, priceCents: number, extra: Partial<Offer> = {}): Offer {
  return {
    chain,
    id: `${chain}-${name}-${sizeText}`,
    name,
    brand,
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

function it_(id: string, name: string, qty: number, wanted: { brand?: string | null; sizeText?: string | null }, offers: Offer[]): PlanItem {
  return {
    id,
    name,
    qty,
    wanted: { name, brand: wanted.brand ?? null, sizeText: wanted.sizeText ?? null, ean: null },
    offers: Object.fromEntries(offers.map((x) => [x.chain, x])),
  };
}

const basket: PlanItem[] = [
  it_('aceite', 'Aceite de oliva virgen extra', 1, { brand: 'Carbonell', sizeText: '1 L' }, [
    o('mercadona', 'Aceite de oliva virgen extra Carbonell', 'Carbonell', '1 L', 1050),
    o('aldi', 'Aceite de oliva virgen extra', 'Aldi', '1 L', 840, { promo: 'Oferta hasta 21/11' }),
    o('carrefour', 'Aceite de oliva virgen extra Carbonell', 'Carbonell', '1 L', 990, { source: 'open_prices', observedOn: '2026-09-01' }),
  ]),
  it_('leche', 'Leche semidesnatada', 2, { sizeText: '1 L' }, [
    o('mercadona', 'Leche semidesnatada Hacendado', 'Hacendado', '1 L', 89),
    o('aldi', 'Leche semidesnatada Milsani', 'Milsani', '6 x 1 L', 474),
    o('carrefour', 'Leche semidesnatada', 'Carrefour', '1 L', 95, { source: 'open_prices', observedOn: '2026-08-01' }),
  ]),
  it_('arroz', 'Arroz redondo', 1, { sizeText: '1 kg' }, [
    o('mercadona', 'Arroz redondo', 'Hacendado', '1 kg', 135),
    o('aldi', 'Arroz redondo', null, '500 g', 99),
    o('lidl', 'Arroz redondo', null, '1 kg', 125),
  ]),
  it_('avena', 'Bebida de avena', 1, { sizeText: '1 L' }, []),
];

const byId = (tips: Tip[], id: string) => tips.find((t) => t.id === id);

describe('savingTips', () => {
  it('gives concrete tips with numbers, biggest saving first, at most 6', () => {
    const tips = savingTips(basket, optimise(basket), NOW);
    expect(tips.map((t) => t.id)).toEqual(['split', 'single', 'missing', 'promo', 'unit-price', 'own-brand-done']);
    expect(byId(tips, 'split')).toEqual({
      id: 'split',
      icon: expect.any(String),
      title: 'Reparte la compra',
      body: eur('Repartir en 3 súper te ahorra 2,20 € (16 %) frente a comprarlo todo en Mercadona. Son unos 1,10 € por cada súper de más.'),
      savingCents: 220,
    });
    // The plan already buys Aldi's own-brand oil: no switch to chase, a well-done note instead.
    expect(byId(tips, 'own-brand')).toBeUndefined();
    expect(byId(tips, 'own-brand-done')).toEqual({
      id: 'own-brand-done',
      icon: expect.any(String),
      title: 'Ya ahorras con la marca blanca',
      body: eur('Tu plan ya ahorra 1,50 € gracias a la marca blanca en aceite.'),
    });
    expect(byId(tips, 'single')!.body).toBe(eur('Elige Mercadona: todo lo que tiene precio por 13,63 €, 1,49 € menos que en Aldi.'));
    expect(byId(tips, 'missing')!.body).toContain('Bebida de avena');
    expect(byId(tips, 'promo')!.body).toBe('La oferta de Aldi en aceite acaba el 21/11 (en 6 días).');
    expect(byId(tips, 'unit-price')).toMatchObject({
      title: 'Mira el precio por kilo, no el del envase',
      body: eur('En Aldi, arroz cuesta 0,99 € el envase pero sale a 1,98 €/kg; en Lidl, a 1,25 €/kg.'),
    });
    const savings = tips.map((t) => t.savingCents ?? -1);
    expect([...savings].sort((a, b) => b - a)).toEqual(savings);
  });

  // Regression (shared-7): with an item priced nowhere, the headline had no
  // single store to compare with while the split tip claimed a saving.
  it('claims the same saving as the plan when an item has no price anywhere', () => {
    const opt = optimise(basket);
    expect(opt.split.missing).toEqual(['avena']);
    expect(opt.bestSingle).toMatchObject({ chain: 'mercadona', missing: ['avena'] });
    expect(opt.savingCents).toBe(220);
    expect(byId(savingTips(basket, opt, NOW), 'split')!.savingCents).toBe(opt.savingCents);
  });

  it('suggests one more store when the cap holds the saving back', () => {
    const tips = savingTips(basket, optimise(basket, { cap: 1 }), NOW);
    expect(tips[0]).toMatchObject({ id: 'more-stores', savingCents: 220, body: eur('Si pasas también por Aldi y Lidl, ahorras otros 2,20 €.') });
    expect(byId(tips, 'split')).toBeUndefined();
  });

  // Regression (shared-11): "también" was said even when the bigger plan drops
  // the store the current plan uses.
  it('words more stores as a swap when the bigger plan leaves the current store out', () => {
    const items = [
      it_('leche', 'Leche', 1, { sizeText: '1 L' }, [o('aldi', 'Leche', null, '1 L', 150), o('bm', 'Leche', null, '1 L', 100), o('carrefour', 'Leche', null, '1 L', 400)]),
      it_('pan', 'Pan', 1, { sizeText: '1 L' }, [o('aldi', 'Pan', null, '1 L', 150), o('bm', 'Pan', null, '1 L', 400), o('carrefour', 'Pan', null, '1 L', 100)]),
    ];
    const opt = optimise(items, { cap: 1 });
    expect(opt.split.stops.map((s) => s.chain)).toEqual(['aldi']);
    expect(opt.byCap.all.stops.map((s) => s.chain).sort()).toEqual(['bm', 'carrefour']);
    expect(byId(savingTips(items, opt, NOW), 'more-stores')).toMatchObject({
      title: 'Un súper más compensa',
      body: eur('Si cambias Aldi por BM y Carrefour, ahorras 1,00 € más.'),
      savingCents: 100,
    });
  });

  it('is deterministic', () => {
    const a = savingTips(basket, optimise(basket), NOW);
    const b = savingTips(basket.map((x) => ({ ...x })), optimise(basket), new Date(NOW));
    expect(a).toEqual(b);
  });

  it('returns nothing for an empty cart', () => {
    expect(savingTips([], optimise([]), NOW)).toEqual([]);
    const zero = [it_('leche', 'Leche', 0, {}, [o('aldi', 'Leche', null, '1 L', 90)])];
    expect(savingTips(zero, optimise(zero), NOW)).toEqual([]);
  });

  it('pads a thin cart to three tips without repeats', () => {
    const one = [it_('pan', 'Pan de pueblo', 1, {}, [o('aldi', 'Pan de pueblo', null, null, 120)])];
    const tips = savingTips(one, optimise(one), NOW);
    expect(tips).toHaveLength(3);
    expect(new Set(tips.map((t) => t.id)).size).toBe(3);
    expect(tips[0]!.id).toBe('unit-price');
  });

  it('flags stale Open Prices prices used by the plan', () => {
    const items = [
      it_('leche', 'Leche', 1, { sizeText: '1 L' }, [o('carrefour', 'Leche', null, '1 L', 80, { source: 'open_prices', observedOn: '2026-09-01' })]),
      it_('pan', 'Pan', 1, {}, [o('carrefour', 'Pan', null, null, 100, { source: 'open_prices', observedOn: '2026-10-20' })]),
      it_('cafe', 'Café', 1, {}, [o('carrefour', 'Café', null, null, 300, { source: 'open_prices', observedOn: '2026-07-01' })]),
    ];
    const tips = savingTips(items, optimise(items), NOW);
    expect(byId(tips, 'stale')!.body).toBe('2 precios de Open Prices tienen más de 30 días: compruébalos en la tienda.');
    const single = savingTips(items.slice(0, 1), optimise(items.slice(0, 1)), NOW);
    expect(byId(single, 'stale')!.body).toBe('1 precio de Open Prices tiene más de 30 días: compruébalo en la tienda.');
    // Live prices are never stale, and 30 days is not "more than 30".
    const fresh = [it_('leche', 'Leche', 1, {}, [o('aldi', 'Leche', null, null, 80, { observedOn: '2026-01-01' })]),
      it_('pan', 'Pan', 1, {}, [o('lidl', 'Pan', null, null, 80, { source: 'open_prices', observedOn: '2026-10-16' })])];
    expect(byId(savingTips(fresh, optimise(fresh), NOW), 'stale')).toBeUndefined();
  });

  it('warns about demo prices', () => {
    const items = [it_('leche', 'Leche', 1, {}, [o('aldi', 'Leche', null, null, 80, { source: 'demo' })])];
    expect(byId(savingTips(items, optimise(items), NOW), 'demo')!.body).toContain('1 precio es de demostración');
  });

  it('reads promo end dates, soonest first, and skips past ones', () => {
    const items = [
      it_('leche', 'Leche', 1, {}, [o('aldi', 'Leche', null, null, 80, { promo: 'Oferta hasta 10/11' })]),
      it_('pan', 'Pan', 1, {}, [o('lidl', 'Pan', null, null, 80, { promo: 'Oferta hasta el 16/11/2026' })]),
      it_('cafe', 'Café', 1, {}, [o('bm', 'Café', null, null, 80, { promo: '2ª unidad -50 %' })]),
    ];
    expect(byId(savingTips(items, optimise(items), NOW), 'promo')!.body).toBe('La oferta de Lidl en pan acaba el 16/11 (mañana).');
    const today = [it_('pan', 'Pan', 1, {}, [o('lidl', 'Pan', null, null, 80, { promo: 'Hasta 15/11' })])];
    expect(byId(savingTips(today, optimise(today), NOW), 'promo')!.body).toContain('(hoy)');
    // A date without a year that is long gone belongs to next year.
    const december = new Date('2026-12-28T10:00:00Z');
    const nextYear = [it_('pan', 'Pan', 1, {}, [o('lidl', 'Pan', null, null, 80, { promo: 'Oferta hasta 05/01' })])];
    expect(byId(savingTips(nextYear, optimise(nextYear), december), 'promo')!.body).toContain('acaba el 05/01 (en 8 días)');
    const past = [it_('pan', 'Pan', 1, {}, [o('lidl', 'Pan', null, null, 80, { promo: 'Oferta hasta 01/11/2026' })])];
    expect(byId(savingTips(past, optimise(past), NOW), 'promo')).toBeUndefined();
  });

  it('warns about what a pack leaves over', () => {
    const items = [it_('leche', 'Leche semidesnatada', 2, { sizeText: '1 L' }, [o('aldi', 'Leche semidesnatada', 'Milsani', '6 x 1 L', 474)])];
    expect(byId(savingTips(items, optimise(items), NOW), 'leftover')!.body).toBe(
      eur('El pack de 6 de leche en Aldi sale a 0,79 €/L, pero te sobran 4 L. Cómpralo solo si lo vas a gastar.'),
    );
    const small = [it_('arroz', 'Arroz', 1, { sizeText: '500 g' }, [o('aldi', 'Arroz', null, '1 kg', 150)])];
    expect(byId(savingTips(small, optimise(small), NOW), 'leftover')!.body).toContain('El formato de 1 kg de arroz');
    // No tip when the pack fits the need.
    const fits = [it_('leche', 'Leche', 6, { sizeText: '1 L' }, [o('aldi', 'Leche', null, '6 x 1 L', 474)])];
    expect(byId(savingTips(fits, optimise(fits), NOW), 'leftover')).toBeUndefined();
  });

  // Regression (shared-12, heuristics-3): the own-brand tip asked to switch to
  // own brands the plan already bought, repeating a saving another tip counts.
  it('suggests own brands the plan does not buy yet, measured against what it buys', () => {
    const items = [
      it_('aceite', 'Aceite de girasol', 1, { brand: 'Koipesol', sizeText: '1 L' }, [
        o('mercadona', 'Aceite de girasol', 'Hacendado', '1 L', 180),
        o('carrefour', 'Aceite de girasol Koipesol', 'Koipesol', '1 L', 300),
      ]),
      it_('tomate', 'Tomate frito', 2, { brand: 'Orlando', sizeText: '350 g' }, [
        o('lidl', 'Tomate frito', 'Lidl', '350 g', 60),
        o('carrefour', 'Tomate frito Orlando', 'Orlando', '350 g', 110),
      ]),
    ];
    // One store: Carrefour, with both brands.
    const capped = savingTips(items, optimise(items, { cap: 1 }), NOW);
    const tip = byId(capped, 'own-brand')!;
    expect(tip.body).toBe(eur('Mercadona tiene aceite de marca blanca (Hacendado) por 1,20 € menos que Koipesol. Si también eliges marca blanca en tomate, el ahorro sube a 2,20 €.'));
    expect(tip.savingCents).toBe(220);
    expect(byId(capped, 'own-brand-done')).toBeUndefined();
    // No limit: the plan buys both own brands already.
    const free = savingTips(items, optimise(items), NOW);
    expect(byId(free, 'own-brand')).toBeUndefined();
    expect(byId(free, 'own-brand-done')!.body).toBe(eur('Tu plan ya ahorra 2,20 € gracias a la marca blanca en aceite y tomate.'));
    expect(byId(free, 'own-brand-done')!.savingCents).toBeUndefined();
  });

  it('does not count an own-brand saving twice when the plan buys it', () => {
    const items = [it_('leche', 'Leche entera Pascual', 2, { brand: 'Pascual', sizeText: '1 L' }, [
      o('mercadona', 'Leche entera', 'Hacendado', '1 L', 89),
      o('carrefour', 'Leche entera Pascual', 'Pascual', '1 L', 125),
    ])];
    const tips = savingTips(items, optimise(items), NOW);
    expect(byId(tips, 'own-brand')).toBeUndefined();
    expect(tips.filter((t) => t.savingCents === 72).map((t) => t.id)).toEqual(['single']);
    expect(byId(tips, 'own-brand-done')!.body).toBe(eur('Tu plan ya ahorra 0,72 € gracias a la marca blanca en leche.'));
  });

  it('says when no chain has everything (equal coverage: the cheaper chain)', () => {
    const items = [
      it_('cafe', 'Café', 1, {}, [o('mercadona', 'Café', null, null, 450), o('aldi', 'Café', null, null, 500)]),
      it_('nocilla', 'Nocilla', 1, {}, [o('carrefour', 'Nocilla', null, null, 300)]),
    ];
    const tips = savingTips(items, optimise(items, { cap: 1 }), NOW);
    expect(byId(tips, 'coverage')!.body).toBe('El que más tiene es Carrefour: 1 de 2 productos con precio. Para el resto tendrás que ir a otro.');
  });

  it('uses litres in the unit-price tip for liquids', () => {
    const items = [it_('zumo', 'Zumo de naranja', 1, { sizeText: '1 L' }, [
      o('aldi', 'Zumo de naranja', null, '330 ml', 99),
      o('lidl', 'Zumo de naranja', null, '1 L', 180),
    ])];
    expect(byId(savingTips(items, optimise(items), NOW), 'unit-price')!.title).toBe('Mira el precio por litro, no el del envase');
  });

  it('keeps every tip well formed', () => {
    for (const tips of [savingTips(basket, optimise(basket), NOW), savingTips(basket, optimise(basket, { cap: 2, extraStoreCents: 300 }), NOW)]) {
      expect(tips.length).toBeGreaterThanOrEqual(3);
      expect(tips.length).toBeLessThanOrEqual(6);
      for (const t of tips) {
        expect(t.id && t.icon && t.title && t.body).toBeTruthy();
        if (t.savingCents !== undefined) expect(Number.isInteger(t.savingCents) && t.savingCents > 0).toBe(true);
      }
    }
  });
});

describe('EVERGREEN_TIPS', () => {
  it('has ten short, friendly tips with unique ids', () => {
    expect(EVERGREEN_TIPS).toHaveLength(10);
    expect(new Set(EVERGREEN_TIPS.map((t) => t.id)).size).toBe(10);
    for (const t of EVERGREEN_TIPS) {
      expect(t.icon).toBeTruthy();
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.body.length).toBeLessThanOrEqual(120);
      expect(t.savingCents).toBeUndefined();
    }
  });
});
