/**
 * Is this offer the product the user wants, an equivalent, or something else?
 *
 * Pure: no DOM, no Worker globals.
 *
 * Kinds, from strongest to weakest:
 *   exact       same EAN; or same brand + near-identical name + compatible size
 *               (a product without a brand: near-identical name + same size)
 *   same-brand  same brand + a fair name match + a size that is not incompatible
 *   equivalent  strong generic name match (brands ignored) + compatible size
 *   weak        anything else
 *
 * A size is compatible when it is the same base unit and either within +-20 %
 * of the wanted amount, a whole multiple or fraction of it, or the same piece
 * in a different pack ("4 x 125 g" for "6 x 125 g").
 */
import type { Candidate, ChainId, HuntMode, MatchKind, Offer, PriceUnit, WantedProduct } from './types';
import { parseSize, sizeFromName, totalAmount, unitPriceCents, type Size } from './units';

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

/** Spanish stop words plus pack and container words that say nothing about the product. */
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'de', 'del', 'la', 'las', 'el', 'los', 'lo', 'un', 'una', 'unos', 'unas', 'con', 'sin', 'en', 'y', 'e', 'o',
  'a', 'al', 'para', 'por', 'su', 'sus', 'x',
  'pack', 'packs', 'bote', 'botes', 'botella', 'botellas', 'botellin', 'botellines', 'brik', 'briks', 'brick', 'bricks',
  'paquete', 'paquetes', 'bolsa', 'bolsas', 'lata', 'latas', 'tarro', 'tarros', 'envase', 'envases', 'caja', 'cajas',
  'garrafa', 'garrafas', 'formato', 'bandeja', 'bandejas', 'malla', 'frasco', 'tarrina', 'tarrinas', 'sobre', 'sobres',
  'unidad', 'unidades', 'ud', 'uds', 'u', 'pieza', 'piezas', 'aprox', 'aproximadamente', 'peso',
  // Measure words; amounts are compared separately, as sizes.
  'g', 'gr', 'grs', 'gramo', 'gramos', 'kg', 'kgs', 'kilo', 'kilos', 'l', 'lt', 'lts', 'litro', 'litros',
  'ml', 'cl', 'dl', 'docena', 'docenas', 'media', 'medio',
]);

/** Tokens that make a different product when only one side has them. */
const VARIANT_WORDS: ReadonlySet<string> = new Set([
  'lactosa', 'gluten', 'azucar', 'edulcorante', 'light', 'zero', 'desnatada', 'desnatado', 'semidesnatada',
  'semidesnatado', 'entera', 'entero', 'descafeinado', 'descafeinada', 'integral', 'bio', 'ecologico', 'ecologica',
  'alcohol', 'sal', 'picante', 'proteina', 'vegetal', 'congelado', 'congelada', 'virgen',
].map(stem));

/**
 * Own (white-label) brands per chain, as they appear on labels. A brand field
 * that contains one of these ("Carrefour Bio", "Producto Alcampo") counts too.
 */
export const OWN_BRANDS: Record<ChainId, string[]> = {
  mercadona: ['Hacendado', 'Bosque Verde', 'Deliplus', 'Compy'],
  carrefour: ['Carrefour', 'Simpl'],
  alcampo: ['Alcampo', 'Auchan'],
  aldi: ['Aldi', 'Milsani', 'Choceur', 'Gutbio', "Rio d'Oro", 'Lacura', 'Tandil'],
  lidl: ['Lidl', 'Milbona', 'Pikok', 'W5', 'Formil', 'Freeway', 'Solevita', 'Combino', 'Belbake', 'Fin Carré', 'Favorina', 'Snack Day', 'Vitasia', 'Deluxe'],
  ahorramas: ['Alipende', 'Ahorramas'],
  supercor: ['El Corte Inglés', 'Aliada', 'Supercor'],
  bm: ['BM'],
};

/** Lowercase, no accents, "s/" -> "sin", only [a-z0-9] words separated by single spaces. */
export function normText(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\bs\//g, ' sin ')
    .replace(/\bc\//g, ' con ')
    .replace(/&/g, ' y ')
    .replace(/['\u2019]/g, '')
    .replace(/\bsemi[\s-]+(desnatad[oa]s?)\b/g, 'semi$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const OWN_BRAND_PHRASES: Array<{ chain: ChainId; label: string; phrase: string }> = (Object.keys(OWN_BRANDS) as ChainId[])
  .flatMap((chain) => OWN_BRANDS[chain].map((label) => ({ chain, label, phrase: normText(label) })))
  .sort((a, b) => b.phrase.length - a.phrase.length);

/** A size-like or numeric token: "1", "500g", "6x1l", "1x". */
const SIZE_TOKEN = /^\d+(?:x\d+)*(?:kg|kgs|g|gr|grs|l|lt|ml|cl|ud|uds|u|x)?$/;

/**
 * Normalised words of a product name: lowercase, no accents, no Spanish stop
 * words, no pack words, no numbers or sizes. Order kept, duplicates dropped.
 */
export function tokens(s: string): string[] {
  const out: string[] = [];
  for (const w of normText(s).split(' ')) {
    if (!w || STOP_WORDS.has(w) || SIZE_TOKEN.test(w) || out.includes(w)) continue;
    out.push(w);
  }
  return out;
}

/** A light Spanish plural stemmer: "huevos" -> "huevo", "limones" -> "limon", "tomates" -> "tomate". */
function stem(w: string): string {
  if (w.length > 4 && w.endsWith('es') && /[lnrdzj]/.test(w[w.length - 3]!)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

function hasPhrase(haystack: string, phrase: string): boolean {
  return !!phrase && ` ${haystack} `.includes(` ${phrase} `);
}

function removePhrase(haystack: string, phrase: string): string {
  if (!phrase) return haystack;
  return ` ${haystack} `.split(` ${phrase} `).join(' ').replace(/\s+/g, ' ').trim();
}

/** Brand phrases of a brand field; Open Food Facts lists several separated by commas. */
function brandPhrases(brand: string | null | undefined): string[] {
  return (brand ?? '').split(/[,;|]/).map(normText).filter(Boolean);
}

/** The own brand an offer carries (by brand field or name), if any. */
export function ownBrandOf(offer: Pick<Offer, 'brand' | 'name'>): { chain: ChainId; label: string } | null {
  const brands = brandPhrases(offer.brand);
  for (const p of OWN_BRAND_PHRASES) if (brands.some((b) => hasPhrase(b, p.phrase))) return { chain: p.chain, label: p.label };
  if (brands.length) return null;
  const name = normText(offer.name);
  for (const p of OWN_BRAND_PHRASES) if (hasPhrase(name, p.phrase)) return { chain: p.chain, label: p.label };
  return null;
}

/** True for a chain's own brand: "Hacendado", "Carrefour Bio", "Milbona". */
export function isOwnBrand(brand: string | null | undefined): boolean {
  const brands = brandPhrases(brand);
  return OWN_BRAND_PHRASES.some((p) => brands.some((b) => hasPhrase(b, p.phrase)));
}

// ---------------------------------------------------------------------------
// Sizes
// ---------------------------------------------------------------------------

export function wantedSize(w: Pick<WantedProduct, 'sizeText' | 'name'>): Size | null {
  return parseSize(w.sizeText) ?? sizeFromName(w.name ?? '');
}

export function offerSize(o: Pick<Offer, 'sizeText' | 'name'>): Size | null {
  return parseSize(o.sizeText) ?? sizeFromName(o.name ?? '');
}

/**
 * How an offer's size relates to the wanted one.
 *   same         totals within +-20 %
 *   pack         same piece (+-20 %) in a different pack, or a whole multiple / fraction
 *   any          the wanted size is unknown, so any size will do
 *   unknown      the wanted size is known but the offer's is not
 *   incompatible different base unit, or amounts that do not line up
 */
export type SizeRelation = 'same' | 'pack' | 'any' | 'unknown' | 'incompatible';

const near = (a: number, b: number) => b > 0 && a >= b * 0.8 && a <= b * 1.2;

function nearInteger(x: number): boolean {
  const r = Math.round(x);
  return r >= 2 && Math.abs(x - r) <= 0.1 * r;
}

export function sizeRelation(wanted: Size | null, offer: Size | null): SizeRelation {
  if (!wanted) return 'any';
  if (!offer) return 'unknown';
  if (wanted.unit !== offer.unit) return 'incompatible';
  const w = totalAmount(wanted);
  const o = totalAmount(offer);
  if (!(w > 0) || !(o > 0)) return 'unknown';
  if (near(o, w)) return 'same';
  if (near(offer.amount, wanted.amount) || near(offer.amount, w) || near(o, wanted.amount)) return 'pack';
  if (nearInteger(o / w) || nearInteger(w / o)) return 'pack';
  return 'incompatible';
}

const sizeOk = (r: SizeRelation) => r === 'same' || r === 'pack' || r === 'any';

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

/** Name thresholds on the 0..1 name score. */
export const EXACT_NAME = 0.9;
export const STRONG_NAME = 0.75;
export const FAIR_NAME = 0.6;

type BrandRelation = 'same' | 'different' | 'unknown';

function brandRelation(wanted: WantedProduct, offer: Offer): BrandRelation {
  const wb = brandPhrases(wanted.brand);
  const ob = brandPhrases(offer.brand);
  if (wb.length && ob.length) {
    const match = wb.some((a) => ob.some((b) => a === b || hasPhrase(a, b) || hasPhrase(b, a)));
    return match ? 'same' : 'different';
  }
  if (wb.length) {
    if (wb.some((a) => hasPhrase(normText(offer.name), a))) return 'same';
    return ownBrandOf(offer) ? 'different' : 'unknown';
  }
  if (ob.length && ob.some((b) => hasPhrase(normText(wanted.name), b))) return 'same';
  return 'unknown';
}

/** Name words with every brand phrase (both sides' and every own brand) removed, stemmed. */
function nameStems(name: string, brands: string[]): string[] {
  let n = normText(name);
  for (const b of brands) n = removePhrase(n, b);
  for (const p of OWN_BRAND_PHRASES) n = removePhrase(n, p.phrase);
  const t = tokens(n).map(stem);
  // A name that was only a brand ("Coca-Cola") keeps its words.
  return t.length ? t : tokens(name).map(stem);
}

function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  return a.length >= 5 && b.length >= 5 && (a.startsWith(b) || b.startsWith(a));
}

/**
 * 0..1: the F1 of the two word sets (words of the wanted name found in the
 * offer's, and the other way round), cut by 30 % per variant word on one side
 * only (lactosa, light, integral...), and capped at 0.6 when the head noun
 * (the wanted name's first word) is missing.
 */
function nameScore(w: string[], o: string[]): number {
  if (!w.length || !o.length) return 0;
  const hitsW = w.filter((a) => o.some((b) => tokenMatch(a, b))).length;
  const hitsO = o.filter((b) => w.some((a) => tokenMatch(a, b))).length;
  const recall = hitsW / w.length;
  const precision = hitsO / o.length;
  let score = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
  const variants = [...w.filter((a) => !o.includes(a)), ...o.filter((b) => !w.includes(b))].filter((x) => VARIANT_WORDS.has(x));
  score *= 0.7 ** variants.length;
  if (!o.some((b) => tokenMatch(w[0]!, b))) score = Math.min(score, 0.6);
  return Math.round(score * 1000) / 1000;
}

function eanKey(ean: string | null | undefined): string | null {
  const d = (ean ?? '').replace(/\D/g, '');
  return d.length >= 8 && d.length <= 14 ? d.padStart(14, '0').slice(-13) : null;
}

const SIZE_POINTS: Record<SizeRelation, number> = { same: 1, pack: 0.7, any: 0.6, unknown: 0.4, incompatible: 0 };
const BRAND_POINTS: Record<BrandRelation, number> = { same: 1, unknown: 0.5, different: 0 };

/**
 * Scores an offer against the wanted product. The score (0..1) does not depend
 * on the hunt mode; the mode only decides which kinds are acceptable.
 */
export function scoreCandidate(wanted: WantedProduct, offer: Offer): { score: number; kind: MatchKind } {
  const we = eanKey(wanted.ean);
  const oe = eanKey(offer.ean);
  if (we && oe && we === oe) return { score: 1, kind: 'exact' };

  const brands = [...brandPhrases(wanted.brand), ...brandPhrases(offer.brand)];
  const name = nameScore(nameStems(wanted.name, brands), nameStems(offer.name, brands));
  const brand = brandRelation(wanted, offer);
  const size = sizeRelation(wantedSize(wanted), offerSize(offer));

  let score = 0.6 * name + 0.2 * BRAND_POINTS[brand] + 0.2 * SIZE_POINTS[size];
  // Two different known EANs: likely a variant, never quite as sure.
  if (we && oe) score *= 0.95;
  score = Math.min(0.99, Math.round(score * 1000) / 1000);

  let kind: MatchKind = 'weak';
  if (brand === 'same' && name >= EXACT_NAME && sizeOk(size)) kind = 'exact';
  else if (!brandPhrases(wanted.brand).length && name >= EXACT_NAME && (size === 'same' || size === 'any')) kind = 'exact';
  else if (brand === 'same' && name >= FAIR_NAME && size !== 'incompatible') kind = 'same-brand';
  else if (name >= STRONG_NAME && sizeOk(size)) kind = 'equivalent';
  return { score, kind };
}

// ---------------------------------------------------------------------------
// Cost and picking
// ---------------------------------------------------------------------------

/**
 * What it costs to buy `qty` of the wanted size with this offer, buying whole packs.
 * With both sizes known (same base unit): a pack that matches the wanted size
 * (+-20 %) counts one for one; a multipack of the wanted piece is bought by
 * pieces; otherwise packs = ceil(needed / pack). Without sizes, packs = qty.
 * `leftover` is what is bought beyond the need (one piece of that total).
 */
export function costFor(offer: Offer, wanted: Size | null, qty: number): { cents: number; packs: number; leftover: Size | null } {
  const q = Number.isFinite(qty) ? Math.max(0, Math.ceil(qty)) : 0;
  const price = Number.isFinite(offer.priceCents) ? Math.max(0, offer.priceCents) : 0;
  const pack = offerSize(offer);
  const plain = { cents: q * price, packs: q, leftover: null };
  if (!wanted || !pack || wanted.unit !== pack.unit || q === 0) return plain;
  const wTotal = totalAmount(wanted);
  const pTotal = totalAmount(pack);
  if (!(wTotal > 0) || !(pTotal > 0)) return plain;

  let packs: number;
  let leftoverAmount = 0;
  if (near(pack.amount, wanted.amount) && (pack.count > 1 || wanted.count > 1)) {
    // Same piece, different pack: "6 x 1 L" for "1 L", "4 x 125 g" for "6 x 125 g".
    const pieces = q * wanted.count;
    packs = Math.ceil(pieces / pack.count);
    leftoverAmount = (packs * pack.count - pieces) * pack.amount;
  } else if (near(pTotal, wTotal)) {
    packs = q;
  } else if (pack.count > 1 && near(pack.amount, wTotal)) {
    // A multipack whose piece is one wanted unit.
    packs = Math.ceil(q / pack.count);
    leftoverAmount = (packs * pack.count - q) * pack.amount;
  } else if (wanted.count > 1 && near(pTotal, wanted.amount)) {
    // A single piece of a wanted multipack.
    packs = q * wanted.count;
  } else {
    const needed = q * wTotal;
    packs = Math.max(1, Math.ceil(needed / pTotal - 1e-9));
    leftoverAmount = packs * pTotal - needed;
  }
  leftoverAmount = Math.round(leftoverAmount * 1000) / 1000;
  return {
    cents: packs * price,
    packs,
    leftover: leftoverAmount > 0 ? { count: 1, amount: leftoverAmount, unit: pack.unit } : null,
  };
}

const KIND_RANK: Record<MatchKind, number> = { exact: 0, 'same-brand': 1, equivalent: 2, weak: 3 };

/** Kinds a mode accepts as a pick. */
export function acceptable(kind: MatchKind, mode: HuntMode): boolean {
  return mode === 'exact' ? kind === 'exact' || kind === 'same-brand' : kind !== 'weak';
}

const validOffer = (o: Offer) => Number.isFinite(o.priceCents) && o.priceCents > 0;
const byId = (a: Offer, b: Offer) => (a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Scores and sorts a chain's offers for the wanted product, at most 5.
 * Exact mode: weak ones dropped; best kind, then score, then price.
 * Equivalent mode: acceptable ones first, cheapest for one wanted unit first.
 */
export function rankCandidates(wanted: WantedProduct, offers: Offer[], mode: HuntMode): Candidate[] {
  const size = wantedSize(wanted);
  const scored = offers.filter(validOffer).map((o) => ({ ...o, ...scoreCandidate(wanted, o) }) as Candidate);
  const list = mode === 'exact' ? scored.filter((c) => c.kind !== 'weak') : scored;
  const cost = new Map(list.map((c) => [c, costFor(c, size, 1).cents]));
  list.sort((a, b) => {
    if (mode === 'exact') {
      return KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.score - a.score || a.priceCents - b.priceCents || byId(a, b);
    }
    const okA = acceptable(a.kind, mode) ? 0 : 1;
    const okB = acceptable(b.kind, mode) ? 0 : 1;
    return okA - okB || cost.get(a)! - cost.get(b)! || b.score - a.score || byId(a, b);
  });
  return list.slice(0, 5);
}

/**
 * The offer to buy at one chain.
 * Exact mode: the best exact (then same-brand) match by score, then cost.
 * Equivalent mode: the cheapest acceptable match for the needed amount.
 */
export function pickBest(candidates: Candidate[], mode: HuntMode, wanted: WantedProduct, qty: number): Candidate | null {
  const size = wantedSize(wanted);
  const q = Math.max(1, Number.isFinite(qty) ? qty : 1);
  const ok = candidates.filter((c) => validOffer(c) && acceptable(c.kind, mode));
  if (!ok.length) return null;
  const cost = new Map(ok.map((c) => [c, costFor(c, size, q).cents]));
  const score2 = (c: Candidate) => Math.round(c.score * 100);
  ok.sort((a, b) => {
    if (mode === 'exact') return KIND_RANK[a.kind] - KIND_RANK[b.kind] || score2(b) - score2(a) || cost.get(a)! - cost.get(b)! || byId(a, b);
    return cost.get(a)! - cost.get(b)! || b.score - a.score || byId(a, b);
  });
  return ok[0]!;
}

/** Unit price of an offer: computed from its size, else as published. */
export function offerUnitPrice(o: Offer): { cents: number; unit: PriceUnit } | null {
  const computed = unitPriceCents(o.priceCents, offerSize(o));
  if (computed) return computed;
  return o.unitPriceCents != null && o.unit && Number.isFinite(o.unitPriceCents) ? { cents: o.unitPriceCents, unit: o.unit } : null;
}
