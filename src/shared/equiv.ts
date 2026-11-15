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
 *
 * Names are compared word by word, without brands. A variant on one side only
 * cuts the name score: "sin lactosa", "con gas", "virgen extra", "0,0",
 * "azucarado", "en polvo", a flavour, or a different percentage ("70 %").
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

/** "Virgen extra" is read as one word, so it differs from plain "virgen". */
const VIRGEN_EXTRA = 'virgen_extra';

/** Words that make a different product when only one side has them. */
const VARIANT_WORDS: ReadonlySet<string> = new Set([
  'lactosa', 'gluten', 'azucar', 'edulcorante', 'light', 'zero', 'desnatada', 'desnatado', 'semidesnatada',
  'semidesnatado', 'entera', 'entero', 'descafeinado', 'descafeinada', 'integral', 'bio', 'ecologico', 'ecologica',
  'alcohol', 'sal', 'picante', 'proteina', 'vegetal', 'congelado', 'congelada', 'virgen', VIRGEN_EXTRA,
  'gas', 'azucarado', 'azucarada', 'edulcorado', 'edulcorada', 'polvo', 'condensada', 'condensado', 'evaporada',
  'evaporado',
  // Flavours.
  'fresa', 'chocolate', 'vainilla', 'limon', 'naranja', 'platano', 'coco', 'caramelo', 'menta', 'melocoton',
  'frambuesa', 'avellana',
].map(stem));

/** What a "sin X" may leave out and still be another product: "aceitunas sin hueso". */
const SIN_VARIANTS: ReadonlySet<string> = new Set([
  'hueso', 'piel', 'espina', 'cafeina', 'grasa', 'corteza', 'semilla', 'pepita', 'cascara', 'espina', 'teina',
].map(stem));

/**
 * "sin X" is read as one word ("sin_lactosa"), a variant when X is: so "agua
 * sin gas" and "agua con gas" ("gas") differ, and "sin conservantes" is only
 * a word. "Sin gas" alone is what plain water is, so only "gas" marks it.
 */
function isVariant(w: string): boolean {
  if (!w.startsWith('sin_')) return VARIANT_WORDS.has(w);
  const x = w.slice(4);
  return x !== 'gas' && (VARIANT_WORDS.has(x) || SIN_VARIANTS.has(x));
}

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

// ---------------------------------------------------------------------------
// Words for matching (tokens() stays as it is: the catalogue search uses it)
// ---------------------------------------------------------------------------

/** "0,0" (beer) and "0 % alcohol" mean "sin alcohol". */
const ALCOHOL_FREE = /(?<![\d.,])0[.,]0(?!\d)\s*%?|(?<![\d.,])0\s*%\s*(?:de\s+)?(?:vol\.?\s*)?alcohol/gi;
/** "0 % M.G.", "0 % materia grasa": the same as a bare "0 %". */
const FAT_FREE = /(?<![\d.,])0\s*%\s*(?:de\s+)?(?:m\.?\s*g\.?|materia\s+grasa|grasas?)(?![a-z])/gi;
/** "0 % lactosa", "0 % azúcares": "sin lactosa", "sin azúcares". */
const ZERO_OF = /(?<![\d.,])0\s*%\s*(?:de\s+)?(?=(?:lactosa|az[u\u00fa]car|gluten|sal(?![a-z])|edulcorante))/gi;
/** "70 %", "3,6%", "0 %": a share that names a variant (cocoa, fat). */
const PERCENT = /(?<![\d.,])(\d{1,3}(?:[.,]\d{1,2})?)\s*%/g;

/**
 * Normalised text for matching: "0,0" reads "sin alcohol", "0 % lactosa"
 * reads "sin lactosa", and percentages are taken out into `pcts` ("70pct"),
 * because normText would turn them into bare numbers that tokens() drops.
 */
function matchText(raw: string | null | undefined, pcts: string[] = []): string {
  const pct = (n: string) => {
    const key = `${n.replace(/[.,]/, 'p').replace(/p0+$/, '')}pct`;
    if (!pcts.includes(key)) pcts.push(key);
    return ' ';
  };
  const t = (raw ?? '')
    .replace(ALCOHOL_FREE, ' sin alcohol ')
    .replace(FAT_FREE, () => pct('0'))
    .replace(ZERO_OF, ' sin ')
    .replace(PERCENT, (_, n: string) => pct(n));
  return normText(t);
}

const plainWord = (w: string | undefined): w is string => !!w && !STOP_WORDS.has(w) && !SIZE_TOKEN.test(w);

/**
 * Stemmed words of a normalised text, as tokens() keeps them, except that
 * "sin X" is one word ("sin_gas"), "virgen extra" is one word and "AOVE" is
 * "aceite oliva virgen extra".
 */
function matchWords(n: string): string[] {
  const raw = n.split(' ');
  const out: string[] = [];
  const push = (w: string) => {
    if (!out.includes(w)) out.push(w);
  };
  for (let i = 0; i < raw.length; i++) {
    const w = raw[i]!;
    if (w === 'sin') {
      let j = i + 1;
      while (j < raw.length && raw[j] !== 'sin' && STOP_WORDS.has(raw[j]!)) j++;
      if (plainWord(raw[j])) {
        push(`sin_${stem(raw[j]!)}`);
        i = j;
      }
      continue;
    }
    if (w === 'aove') {
      push('aceite');
      push('oliva');
      push(VIRGEN_EXTRA);
    } else if (w === 'virgen' && raw[i + 1] === 'extra') {
      push(VIRGEN_EXTRA);
      i++;
    } else if (plainWord(w)) push(stem(w));
  }
  return out;
}

/** Words of a brand phrase that name a variant: "bio" in "carrefour bio", "sin lactosa" in "puleva sin lactosa". */
function brandVariantText(phrase: string): string {
  const ws = phrase.split(' ');
  const keep: string[] = [];
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i]!;
    if ((w === 'sin' && ws[i + 1]) || (w === 'virgen' && ws[i + 1] === 'extra')) keep.push(w, ws[++i]!);
    else if (VARIANT_WORDS.has(stem(w))) keep.push(w);
  }
  return keep.join(' ');
}

/** Removes a brand phrase from a name, but keeps the variant words inside it ("Carrefour Bio" leaves "bio"). */
function stripBrand(haystack: string, phrase: string): string {
  if (!hasPhrase(haystack, phrase)) return haystack;
  return ` ${haystack} `.split(` ${phrase} `).join(` ${brandVariantText(phrase)} `).replace(/\s+/g, ' ').trim();
}

interface NameWords {
  /** Stemmed words, brands removed. */
  words: string[];
  /** Percentages ("70pct", "0pct"). */
  pcts: string[];
}

/**
 * The words of one side's name with every brand phrase (both sides' and every
 * own brand) removed, plus the variant words of this side's own brand field
 * ("Puleva Sin Lactosa" adds "sin_lactosa").
 */
function nameWords(name: string, ownBrand: string | null, brands: string[]): NameWords {
  const pcts: string[] = [];
  let n = matchText(name, pcts);
  for (const b of brands) n = stripBrand(n, b);
  for (const p of OWN_BRAND_PHRASES) n = stripBrand(n, p.phrase);
  // A name that was only a brand ("Coca-Cola") keeps its words.
  const words = matchWords(n);
  if (!words.length) words.push(...matchWords(matchText(name)));
  for (const b of (ownBrand ?? '').split(/[,;|]/)) {
    for (const w of matchWords(brandVariantText(matchText(b)))) if (!words.includes(w)) words.push(w);
  }
  return { words, pcts };
}

/**
 * Two words are the same word when equal, when one is the other plus one
 * letter ("yogur", "yogurt"), or when the shorter is a long cut-off word
 * ("semidesn" for "semidesnatada"). Not "salmon" / "salmonete", "naranja" /
 * "naranjada" or "leche" / "lechera".
 */
function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length < 5 || !long.startsWith(short)) return false;
  return long.length - short.length <= 1 || short.length >= 8;
}

/**
 * 0..1: the F1 of the two word sets (words of the wanted name found in the
 * offer's, and the other way round), cut by 30 % per variant word on one side
 * only (lactosa, light, integral, sin gas...) and once more for a percentage
 * that differs ("70 %" vs "85 %", or a "0 %" on one side only), and capped at
 * 0.6 when the head noun (the wanted name's first word) is missing.
 */
function nameScore(wanted: NameWords, offer: NameWords): number {
  const w = wanted.words;
  const o = offer.words;
  if (!w.length || !o.length) return 0;
  const hitsW = w.filter((a) => o.some((b) => tokenMatch(a, b))).length;
  const hitsO = o.filter((b) => w.some((a) => tokenMatch(a, b))).length;
  const recall = hitsW / w.length;
  const precision = hitsO / o.length;
  let score = recall + precision > 0 ? (2 * recall * precision) / (recall + precision) : 0;
  const variants = [...w.filter((a) => !o.some((b) => tokenMatch(a, b))), ...o.filter((b) => !w.some((a) => tokenMatch(a, b)))].filter(isVariant);
  score *= 0.7 ** variants.length;
  const wp = wanted.pcts;
  const op = offer.pcts;
  const pctDiffers = wp.length && op.length
    ? wp.some((p) => !op.includes(p)) || op.some((p) => !wp.includes(p))
    : wp.includes('0pct') || op.includes('0pct');
  if (pctDiffers) score *= 0.7;
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

  const brands = [wanted.brand, offer.brand].flatMap((b) => (b ?? '').split(/[,;|]/).map((x) => matchText(x))).filter(Boolean);
  const name = nameScore(nameWords(wanted.name, wanted.brand, brands), nameWords(offer.name, offer.brand, brands));
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
 * A piece of `a` can stand in for one wanted piece of `b`: at most 3 % short
 * (labels round, "0,97 L") and at most 20 % over. Matching is looser (+-20 %,
 * see sizeRelation), but a smaller piece must never be costed as a whole one:
 * five 800 g bags are 4 kg, not 5 kg.
 */
const fits = (a: number, b: number) => b > 0 && a >= b * 0.97 && a <= b * 1.2;

/**
 * What it costs to buy `qty` of the wanted size with this offer, buying whole packs.
 * With both sizes known (same base unit): a multipack of the wanted piece is
 * bought by pieces; otherwise packs = ceil(needed / pack), where a pack at most
 * 3 % short of the wanted size counts as a whole one. Without sizes, packs = qty.
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
  if (fits(pack.amount, wanted.amount) && (pack.count > 1 || wanted.count > 1)) {
    // Same piece, different pack: "6 x 1 L" for "1 L", "4 x 125 g" for "6 x 125 g".
    const pieces = q * wanted.count;
    packs = Math.ceil(pieces / pack.count);
    leftoverAmount = (packs * pack.count - pieces) * pack.amount;
  } else if (pack.count > 1 && fits(pack.amount, wTotal)) {
    // A multipack whose piece is one wanted unit.
    packs = Math.ceil(q / pack.count);
    leftoverAmount = (packs * pack.count - q) * pack.amount;
  } else if (wanted.count > 1 && fits(pTotal, wanted.amount)) {
    // A single piece of a wanted multipack.
    packs = q * wanted.count;
  } else {
    const needed = q * wTotal;
    // A pack a hair short of the wanted size ("0,97 L" for "1 L") counts as a whole one.
    const per = pTotal < wTotal && fits(pTotal, wTotal) ? wTotal : pTotal;
    packs = Math.max(1, Math.ceil(needed / per - 1e-9));
    leftoverAmount = Math.max(0, packs * pTotal - needed);
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
const normQty = (qty: number | undefined) => Math.max(1, Number.isFinite(qty) ? Math.ceil(qty!) : 1);

/** Most candidates a chain answers with. */
const MAX_CANDIDATES = 5;
/** Quantities whose picks rankCandidates always keeps, so a later change of quantity still finds its best pack. */
const KEEP_FOR_QTY = [1, 24, 6, 12, 2, 3];

/**
 * Can this candidate be bought on its own merit? Not when the wanted size is
 * known and the offer's is not (a sizeless "Leche Pascual" for "6 x 1 L"):
 * its cost cannot be checked, so it is listed for the user to choose but never
 * picked. A matching EAN is the same product, so it always can.
 */
function pickable(c: Candidate, wanted: WantedProduct, size: Size | null): boolean {
  if (!validOffer(c)) return false;
  if (!size || offerSize(c)) return true;
  const we = eanKey(wanted.ean);
  return !!we && we === eanKey(c.ean);
}

/**
 * The order picks are made in, best first.
 * Exact mode: exact before same-brand. Every exact candidate is the wanted
 * product (perhaps in another pack), so the cheapest for the needed amount
 * wins; same-brand ones are variants, so the closest wins, then the cheapest.
 * Equivalent mode: the cheapest for the needed amount, then the closest.
 */
function pickOrder(mode: HuntMode, cost: (c: Candidate) => number): (a: Candidate, b: Candidate) => number {
  const score2 = (c: Candidate) => Math.round(c.score * 100);
  return (a, b) => {
    if (mode === 'exact') {
      return (
        KIND_RANK[a.kind] - KIND_RANK[b.kind]
        || (a.kind === 'exact' ? 0 : score2(b) - score2(a))
        || cost(a) - cost(b)
        || b.score - a.score
        || byId(a, b)
      );
    }
    return cost(a) - cost(b) || b.score - a.score || byId(a, b);
  };
}

function costMemo(size: Size | null, qty: number): (c: Candidate) => number {
  const memo = new Map<Candidate, number>();
  return (c) => {
    let v = memo.get(c);
    if (v === undefined) memo.set(c, (v = costFor(c, size, qty).cents));
    return v;
  };
}

/**
 * Scores and sorts a chain's offers for the wanted product, at most 5, in the
 * order pickBest would choose them for `qty` (default 1): candidates it can
 * pick first, then the rest. Exact mode drops weak ones and lists by kind.
 * The 5 always include the picks for other quantities too (1, 2, 3, 6, 12,
 * 24), so a 6-pack that is the best buy for six is never cut for being dear
 * for one.
 */
export function rankCandidates(wanted: WantedProduct, offers: Offer[], mode: HuntMode, qty = 1): Candidate[] {
  const size = wantedSize(wanted);
  const q = normQty(qty);
  const scored = offers.filter(validOffer).map((o) => ({ ...o, ...scoreCandidate(wanted, o) }) as Candidate);
  const list = mode === 'exact' ? scored.filter((c) => c.kind !== 'weak') : scored;
  const order = pickOrder(mode, costMemo(size, q));
  const rank = (c: Candidate) => (acceptable(c.kind, mode) && pickable(c, wanted, size) ? 0 : 1);
  list.sort((a, b) => {
    if (mode === 'exact') return KIND_RANK[a.kind] - KIND_RANK[b.kind] || rank(a) - rank(b) || order(a, b);
    return rank(a) - rank(b) || order(a, b);
  });
  const keep = new Set<Candidate>();
  for (const n of [q, ...KEEP_FOR_QTY]) {
    if (keep.size >= MAX_CANDIDATES) break;
    const p = pickBest(list, mode, wanted, n);
    if (p) keep.add(p);
  }
  let room = MAX_CANDIDATES - keep.size;
  return list.filter((c) => keep.has(c) || room-- > 0);
}

/**
 * The offer to buy at one chain, for `qty` wanted units.
 * Exact mode: an exact match (the cheapest for the needed amount), else the
 * closest same-brand one. Equivalent mode: the cheapest acceptable match for
 * the needed amount. An offer whose size is unknown while the wanted one is
 * known is never picked (see pickable).
 */
export function pickBest(candidates: Candidate[], mode: HuntMode, wanted: WantedProduct, qty: number): Candidate | null {
  const size = wantedSize(wanted);
  const ok = candidates.filter((c) => acceptable(c.kind, mode) && pickable(c, wanted, size));
  if (!ok.length) return null;
  ok.sort(pickOrder(mode, costMemo(size, normQty(qty))));
  return ok[0]!;
}

/** Unit price of an offer: computed from its size, else as published. */
export function offerUnitPrice(o: Offer): { cents: number; unit: PriceUnit } | null {
  const computed = unitPriceCents(o.priceCents, offerSize(o));
  if (computed) return computed;
  return o.unitPriceCents != null && o.unit && Number.isFinite(o.unitPriceCents) ? { cents: o.unitPriceCents, unit: o.unit } : null;
}
