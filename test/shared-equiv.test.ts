import { describe, expect, it } from 'vitest';
import {
  costFor,
  isOwnBrand,
  offerUnitPrice,
  ownBrandOf,
  pickBest,
  rankCandidates,
  scoreCandidate,
  sizeRelation,
  tokens,
  wantedSize,
} from '../src/shared/equiv';
import type { Candidate, ChainId, Offer, WantedProduct } from '../src/shared/types';
import { parseSize, type Size } from '../src/shared/units';

let seq = 0;
function offer(name: string, brand: string | null, sizeText: string | null, priceCents = 100, extra: Partial<Offer> = {}): Offer {
  return {
    chain: 'aldi',
    id: `o${++seq}`,
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

const S = (count: number, amount: number, unit: Size['unit']): Size => ({ count, amount, unit });

const pascual: WantedProduct = { name: 'Leche semidesnatada Pascual', brand: 'Pascual', sizeText: '1 L', ean: '8410128000017' };
const carbonell: WantedProduct = { name: 'Aceite de oliva virgen extra', brand: 'Carbonell', sizeText: '1 l', ean: null };

describe('tokens', () => {
  it('lowercases, strips accents and drops Spanish stop words and pack words', () => {
    expect(tokens('Café molido de Colombia, en bolsa')).toEqual(['cafe', 'molido', 'colombia']);
    expect(tokens('Leche del pueblo con la miel y el limón para ti')).toEqual(['leche', 'pueblo', 'miel', 'limon', 'ti']);
    expect(tokens('Pack bote botella brik paquete bolsa')).toEqual([]);
  });

  it('drops sizes and numbers but keeps alphanumeric words', () => {
    expect(tokens('Leche Semidesnatada s/lactosa brik 1,5 L 6x1L 500g')).toEqual(['leche', 'semidesnatada', 'lactosa']);
    expect(tokens('Complemento B12 Omega3')).toEqual(['complemento', 'b12', 'omega3']);
  });

  it('joins "semi desnatada" and removes repeats', () => {
    expect(tokens('Leche semi desnatada leche')).toEqual(['leche', 'semidesnatada']);
  });

  it('returns nothing for empty text', () => {
    expect(tokens('')).toEqual([]);
    expect(tokens('  de la  ')).toEqual([]);
  });
});

describe('own brands', () => {
  it('knows the chains own brands, also inside longer brand fields', () => {
    expect(isOwnBrand('Hacendado')).toBe(true);
    expect(isOwnBrand('Carrefour Bio')).toBe(true);
    expect(isOwnBrand('El Corte Inglés')).toBe(true);
    expect(isOwnBrand('Pascual')).toBe(false);
    expect(isOwnBrand(null)).toBe(false);
    expect(isOwnBrand('')).toBe(false);
  });

  it('finds an own brand in the name when the brand field is empty', () => {
    expect(ownBrandOf({ brand: null, name: 'Leche entera Hacendado 1 L' })).toEqual({ chain: 'mercadona', label: 'Hacendado' });
    expect(ownBrandOf({ brand: 'Milsani', name: 'Leche' })).toEqual({ chain: 'aldi', label: 'Milsani' });
    expect(ownBrandOf({ brand: 'Pascual', name: 'Leche Hacendado' })).toBeNull();
  });
});

describe('sizeRelation', () => {
  const L1 = S(1, 1000, 'ml');
  it('classifies sizes against the wanted one', () => {
    expect(sizeRelation(L1, S(1, 1000, 'ml'))).toBe('same');
    expect(sizeRelation(L1, S(1, 850, 'ml'))).toBe('same');
    expect(sizeRelation(L1, S(1, 1200, 'ml'))).toBe('same');
    expect(sizeRelation(L1, S(6, 1000, 'ml'))).toBe('pack');
    expect(sizeRelation(L1, S(1, 5000, 'ml'))).toBe('pack');
    expect(sizeRelation(L1, S(1, 500, 'ml'))).toBe('pack');
    expect(sizeRelation(S(6, 125, 'g'), S(4, 125, 'g'))).toBe('pack');
    expect(sizeRelation(L1, S(1, 750, 'ml'))).toBe('incompatible');
    expect(sizeRelation(L1, S(1, 1500, 'ml'))).toBe('incompatible');
    expect(sizeRelation(L1, S(1, 1000, 'g'))).toBe('incompatible');
    expect(sizeRelation(L1, null)).toBe('unknown');
    expect(sizeRelation(null, L1)).toBe('any');
    expect(sizeRelation(null, null)).toBe('any');
  });
});

describe('scoreCandidate', () => {
  it('treats an equal EAN as the exact product, whatever the name says', () => {
    expect(scoreCandidate(pascual, offer('Otra cosa', 'X', '3 kg', 100, { ean: ' 8410128000017 ' }))).toEqual({ score: 1, kind: 'exact' });
    // EAN-13 with a leading zero against its 12-digit UPC form.
    const upc: WantedProduct = { ...pascual, ean: '012345678905' };
    expect(scoreCandidate(upc, offer('x', null, null, 100, { ean: '0012345678905' })).kind).toBe('exact');
  });

  it('matches same brand + same name + compatible size as exact', () => {
    expect(scoreCandidate(pascual, offer('Leche semidesnatada Pascual brik 1 L', 'Pascual', '1 L')).kind).toBe('exact');
    // Brand only in the name.
    expect(scoreCandidate(pascual, offer('Leche Pascual semidesnatada', null, '1 l')).kind).toBe('exact');
    // A multipack of the same product.
    expect(scoreCandidate(pascual, offer('Leche semidesnatada Pascual', 'Pascual', '6 x 1 L')).kind).toBe('exact');
  });

  it('calls a same-brand variant same-brand, not exact', () => {
    const r = scoreCandidate(pascual, offer('Leche Pascual calcio semidesnatada', 'Pascual', '1 L'));
    expect(r.kind).toBe('same-brand');
    expect(r.score).toBeLessThan(0.99);
  });

  it('calls another brand with the same generic name and size equivalent', () => {
    expect(scoreCandidate(pascual, offer('Leche semidesnatada Hacendado', 'Hacendado', '1 L')).kind).toBe('equivalent');
    expect(scoreCandidate(carbonell, offer('Aceite de oliva virgen extra 1 l', 'Olivar', '1 l')).kind).toBe('equivalent');
    expect(scoreCandidate(pascual, offer('Leche semidesnatada', null, '200 ml')).kind).toBe('equivalent');
  });

  it('keeps variants and other products weak', () => {
    expect(scoreCandidate(pascual, offer('Leche semidesnatada sin lactosa Hacendado', 'Hacendado', '1 L')).kind).toBe('weak');
    expect(scoreCandidate(pascual, offer('Leche entera Hacendado', 'Hacendado', '1 L')).kind).toBe('weak');
    expect(scoreCandidate(pascual, offer('Batido de chocolate Pascual', 'Pascual', '1 L')).kind).toBe('weak');
    expect(scoreCandidate(carbonell, offer('Aceite de oliva suave', 'Carbonell', '1 l')).kind).toBe('weak');
    expect(scoreCandidate(carbonell, offer('Aceitunas verdes', 'Carbonell', '1 l')).kind).toBe('weak');
  });

  it('needs a compatible size for equivalent', () => {
    expect(scoreCandidate(pascual, offer('Leche semidesnatada', null, '750 ml')).kind).toBe('weak');
    expect(scoreCandidate(pascual, offer('Leche semidesnatada', null, null)).kind).toBe('weak');
    expect(scoreCandidate(pascual, offer('Leche semidesnatada 1,5 L', null, null)).kind).toBe('weak');
    // Without a wanted size, any size will do.
    const noSize: WantedProduct = { name: 'Leche semidesnatada', brand: null, sizeText: null, ean: null };
    expect(scoreCandidate(noSize, offer('Leche semidesnatada Hacendado', 'Hacendado', '1,5 L')).kind).not.toBe('weak');
  });

  it('reads the size from the name when the size text is missing', () => {
    expect(scoreCandidate(pascual, offer('Leche semidesnatada Hacendado 1 L', 'Hacendado', null)).kind).toBe('equivalent');
  });

  it('lets a product without a brand be matched exactly by name and size', () => {
    const banana: WantedProduct = { name: 'Plátanos de Canarias', brand: null, sizeText: '1 kg', ean: null };
    expect(scoreCandidate(banana, offer('Plátano de Canarias', 'Hacendado', '1 kg')).kind).toBe('exact');
    expect(scoreCandidate(banana, offer('Plátano de Canarias IGP', null, '1 kg')).kind).toBe('equivalent');
    expect(scoreCandidate(banana, offer('Plátano macho', null, '1 kg')).kind).toBe('weak');
  });

  it('scores better matches higher, within 0..1', () => {
    const a = scoreCandidate(pascual, offer('Leche semidesnatada Pascual', 'Pascual', '1 L')).score;
    const b = scoreCandidate(pascual, offer('Leche semidesnatada Hacendado', 'Hacendado', '1 L')).score;
    const c = scoreCandidate(pascual, offer('Leche entera Hacendado', 'Hacendado', '1 L')).score;
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(c);
    for (const s of [a, b, c]) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1);
    }
  });

  it('copes with empty names', () => {
    const r = scoreCandidate({ name: '', brand: null, sizeText: null, ean: null }, offer('', null, null));
    expect(r.kind).toBe('weak');
  });
});

describe('costFor', () => {
  const L1 = parseSize('1 L');
  it('buys whole packs and reports what is left over', () => {
    const pack6 = offer('Leche', null, '6 x 1 L', 474);
    expect(costFor(pack6, L1, 2)).toEqual({ cents: 474, packs: 1, leftover: S(1, 4000, 'ml') });
    expect(costFor(pack6, L1, 6)).toEqual({ cents: 474, packs: 1, leftover: null });
    expect(costFor(pack6, L1, 7)).toEqual({ cents: 948, packs: 2, leftover: S(1, 5000, 'ml') });
  });

  it('divides amounts when pack and wanted size differ', () => {
    const half = offer('Arroz', null, '500 g', 120);
    expect(costFor(half, parseSize('1 kg'), 3)).toEqual({ cents: 720, packs: 6, leftover: null });
    const kilo = offer('Arroz', null, '1 kg', 200);
    expect(costFor(kilo, parseSize('500 g'), 1)).toEqual({ cents: 200, packs: 1, leftover: S(1, 500, 'g') });
    expect(costFor(kilo, parseSize('500 g'), 2)).toEqual({ cents: 200, packs: 1, leftover: null });
    const garrafa = offer('Aceite', null, '5 l', 2000);
    expect(costFor(garrafa, L1, 1)).toEqual({ cents: 2000, packs: 1, leftover: S(1, 4000, 'ml') });
  });

  // Regression (shared-1): a pack up to 20 % smaller used to count as a whole
  // wanted unit, so five 800 g bags were costed as 5 kg.
  it('never counts a smaller pack as a whole wanted unit', () => {
    expect(costFor(offer('Leche', null, '900 ml', 90), L1, 3)).toEqual({ cents: 360, packs: 4, leftover: S(1, 600, 'ml') });
    expect(costFor(offer('Arroz', null, '800 g', 100), parseSize('1 kg'), 5)).toEqual({ cents: 700, packs: 7, leftover: S(1, 600, 'g') });
    expect(costFor(offer('Leche', null, '6 x 900 ml', 500), parseSize('6 x 1 L'), 1)).toEqual({ cents: 1000, packs: 2, leftover: S(1, 4800, 'ml') });
    expect(costFor(offer('Leche', null, '900 ml', 90), parseSize('6 x 1 L'), 1)).toEqual({ cents: 630, packs: 7, leftover: S(1, 300, 'ml') });
  });

  it('counts a pack a hair short of the wanted size as one, and a bigger one by amount', () => {
    expect(costFor(offer('Leche', null, '0,97 L', 90), L1, 3)).toEqual({ cents: 270, packs: 3, leftover: null });
    expect(costFor(offer('Leche', null, '1,2 L', 90), L1, 1)).toEqual({ cents: 90, packs: 1, leftover: S(1, 200, 'ml') });
    expect(costFor(offer('Leche', null, '1,2 L', 90), L1, 6)).toEqual({ cents: 450, packs: 5, leftover: null });
  });

  it('buys pieces of a multipack', () => {
    const four = offer('Yogur', null, '4 x 125 g', 150);
    expect(costFor(four, parseSize('6 x 125 g'), 1)).toEqual({ cents: 300, packs: 2, leftover: S(1, 250, 'g') });
    const single = offer('Leche', null, '1 L', 80);
    expect(costFor(single, parseSize('6 x 1 L'), 1)).toEqual({ cents: 480, packs: 6, leftover: null });
    const half = offer('Cerveza', null, '2 x 500 ml', 100);
    expect(costFor(half, parseSize('6 x 1 L'), 1)).toEqual({ cents: 600, packs: 6, leftover: null });
  });

  it('costs a 6-pack written "6 uds. x 1 l" as one pack for six litres (shared-5)', () => {
    expect(costFor(offer('Leche', null, '6 uds. x 1 l', 540), L1, 6)).toEqual({ cents: 540, packs: 1, leftover: null });
    expect(offerUnitPrice(offer('Leche', null, '6 uds. x 1 l', 540))).toEqual({ cents: 90, unit: 'l' });
  });

  it('falls back to one pack per unit without comparable sizes', () => {
    expect(costFor(offer('Leche', null, null, 95), L1, 3)).toEqual({ cents: 285, packs: 3, leftover: null });
    expect(costFor(offer('Leche', null, '1 L', 95), null, 3)).toEqual({ cents: 285, packs: 3, leftover: null });
    expect(costFor(offer('Queso', null, '250 g', 300), L1, 2)).toEqual({ cents: 600, packs: 2, leftover: null });
  });

  it('handles zero and odd quantities', () => {
    expect(costFor(offer('Leche', null, '1 L', 95), L1, 0)).toEqual({ cents: 0, packs: 0, leftover: null });
    expect(costFor(offer('Leche', null, '1 L', 95), L1, -2)).toEqual({ cents: 0, packs: 0, leftover: null });
    expect(costFor(offer('Leche', null, '1 L', 95), L1, 1.5)).toEqual({ cents: 190, packs: 2, leftover: null });
  });
});

describe('rankCandidates', () => {
  const offers = [
    offer('Leche entera Hacendado', 'Hacendado', '1 L', 80),
    offer('Leche semidesnatada Hacendado', 'Hacendado', '1 L', 85),
    offer('Leche Pascual calcio semidesnatada', 'Pascual', '1 L', 130),
    offer('Leche semidesnatada Pascual', 'Pascual', '1 L', 120),
    offer('Leche semidesnatada Pascual', 'Pascual', '6 x 1 L', 690),
    offer('Leche semidesnatada Milsani', 'Milsani', '6 x 1 L', 474),
    offer('Batido de cacao', 'Pascual', '1 L', 60),
    offer('Leche gratis', null, '1 L', 0),
  ];

  it('in exact mode drops weak ones and puts the best kind first', () => {
    const r = rankCandidates(pascual, offers, 'exact');
    expect(r.every((c) => c.kind !== 'weak')).toBe(true);
    expect(r.map((c) => c.kind)).toEqual(['exact', 'exact', 'same-brand', 'equivalent', 'equivalent']);
    expect(r[0]!.priceCents).toBe(120);
  });

  it('in equivalent mode puts the cheapest acceptable one for a wanted unit first, weak ones last', () => {
    const r = rankCandidates(pascual, offers, 'equivalent');
    expect(r).toHaveLength(5);
    expect(r[0]!.name).toBe('Leche semidesnatada Hacendado');
    expect(r.findIndex((c) => c.kind === 'weak')).toBe(-1);
    const all = rankCandidates(pascual, offers.slice(0, 2), 'equivalent');
    expect(all.map((c) => c.kind)).toEqual(['equivalent', 'weak']);
  });

  it('drops offers without a valid price and copes with none', () => {
    expect(rankCandidates(pascual, [], 'exact')).toEqual([]);
    expect(rankCandidates(pascual, [offer('Leche semidesnatada Pascual', 'Pascual', '1 L', Number.NaN)], 'exact')).toEqual([]);
  });

  it('keeps the offer fields on the candidate', () => {
    const [c] = rankCandidates(pascual, [offer('Leche semidesnatada Pascual', 'Pascual', '1 L', 120, { chain: 'lidl' as ChainId })], 'exact');
    expect(c).toMatchObject({ chain: 'lidl', priceCents: 120, kind: 'exact' });
  });
});

describe('pickBest', () => {
  const cand = (o: Offer, kind: Candidate['kind'], score: number): Candidate => ({ ...o, kind, score });

  it('in exact mode prefers exact over a cheaper same-brand or equivalent', () => {
    const picks = [
      cand(offer('a', null, '1 L', 50), 'equivalent', 0.8),
      cand(offer('b', null, '1 L', 90), 'same-brand', 0.95),
      cand(offer('c', null, '1 L', 120), 'exact', 0.9),
    ];
    expect(pickBest(picks, 'exact', pascual, 1)!.name).toBe('c');
  });

  it('in exact mode breaks score ties by cost for the needed amount', () => {
    const picks = [
      cand(offer('single', null, '1 L', 120), 'exact', 0.99),
      cand(offer('pack', null, '6 x 1 L', 600), 'exact', 0.99),
    ];
    expect(pickBest(picks, 'exact', pascual, 1)!.name).toBe('single');
    expect(pickBest(picks, 'exact', pascual, 6)!.name).toBe('pack');
  });

  it('in exact mode falls back to same-brand, never to an equivalent', () => {
    const sameBrand = cand(offer('sb', null, '1 L', 130), 'same-brand', 0.8);
    const equivalent = cand(offer('eq', null, '1 L', 50), 'equivalent', 0.8);
    expect(pickBest([equivalent, sameBrand], 'exact', pascual, 1)!.name).toBe('sb');
    expect(pickBest([equivalent], 'exact', pascual, 1)).toBeNull();
  });

  it('in equivalent mode picks the cheapest acceptable offer for the needed amount', () => {
    const picks = [
      cand(offer('pascual', null, '1 L', 120), 'exact', 0.99),
      cand(offer('blanca', null, '1 L', 85), 'equivalent', 0.8),
      cand(offer('pack', null, '6 x 1 L', 474), 'equivalent', 0.8),
      cand(offer('raro', null, '1 L', 10), 'weak', 0.3),
    ];
    expect(pickBest(picks, 'equivalent', pascual, 1)!.name).toBe('blanca');
    expect(pickBest(picks, 'equivalent', pascual, 6)!.name).toBe('pack');
  });

  it('returns null when nothing is acceptable', () => {
    expect(pickBest([], 'equivalent', pascual, 1)).toBeNull();
    expect(pickBest([cand(offer('x', null, '1 L', 10), 'weak', 0.4)], 'equivalent', pascual, 1)).toBeNull();
  });

  it('is deterministic on full ties', () => {
    const a = cand(offer('a', null, '1 L', 100, { chain: 'lidl', id: 'b' }), 'equivalent', 0.8);
    const b = cand(offer('b', null, '1 L', 100, { chain: 'aldi', id: 'z' }), 'equivalent', 0.8);
    expect(pickBest([a, b], 'equivalent', pascual, 1)!.chain).toBe('aldi');
    expect(pickBest([b, a], 'equivalent', pascual, 1)!.chain).toBe('aldi');
  });
});

describe('helpers', () => {
  it('reads the wanted size from the size text, else from the name', () => {
    expect(wantedSize(pascual)).toEqual(S(1, 1000, 'ml'));
    expect(wantedSize({ name: 'Arroz 1 kg', sizeText: null })).toEqual(S(1, 1000, 'g'));
    expect(wantedSize({ name: 'Arroz', sizeText: null })).toBeNull();
  });

  it('computes a unit price from the size, else uses the published one', () => {
    expect(offerUnitPrice(offer('Leche', null, '6 x 1 L', 474))).toEqual({ cents: 79, unit: 'l' });
    expect(offerUnitPrice(offer('Fruta', null, null, 300, { unitPriceCents: 199, unit: 'kg' }))).toEqual({ cents: 199, unit: 'kg' });
    expect(offerUnitPrice(offer('Fruta', null, null, 300))).toBeNull();
  });
});
