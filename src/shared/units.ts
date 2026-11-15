/**
 * Sizes, unit prices and money formatting (es-ES).
 *
 * Pure: no DOM, no Worker globals, no Intl (formatting is done by hand so the
 * output is identical in Node, the Worker and every browser).
 *
 * A Size is `count` pieces of `amount` each, in a base unit:
 *   "6 x 1 L"  -> { count: 6, amount: 1000, unit: 'ml' }
 *   "500 g"    -> { count: 1, amount: 500,  unit: 'g' }
 *   "12 ud"    -> { count: 1, amount: 12,   unit: 'ud' }   (a box of 12)
 *   "3 x 4 ud" -> { count: 3, amount: 4,    unit: 'ud' }
 */
import type { PriceUnit } from './types';

export type BaseUnit = 'g' | 'ml' | 'ud';

/** `amount` is per piece; the total is count * amount. */
export interface Size {
  count: number;
  amount: number;
  unit: BaseUnit;
}

/** Non-breaking space, used between a number and its symbol ("1,23 EUR", "11 %"). */
export const NBSP = '\u00a0';

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Unit words -> [base unit, factor to base]. */
const MEASURE_UNITS: Record<string, [BaseUnit, number]> = {
  kilogramos: ['g', 1000], kilogramo: ['g', 1000], kilos: ['g', 1000], kilo: ['g', 1000], kgs: ['g', 1000], kg: ['g', 1000],
  gramos: ['g', 1], gramo: ['g', 1], grs: ['g', 1], gr: ['g', 1], grm: ['g', 1], g: ['g', 1],
  litros: ['ml', 1000], litro: ['ml', 1000], ltrs: ['ml', 1000], ltr: ['ml', 1000], lts: ['ml', 1000], lt: ['ml', 1000], l: ['ml', 1000],
  mililitros: ['ml', 1], mililitro: ['ml', 1], ml: ['ml', 1],
  centilitros: ['ml', 10], centilitro: ['ml', 10], cl: ['ml', 10],
  decilitros: ['ml', 100], decilitro: ['ml', 100], dl: ['ml', 100],
};

/** Words that count pieces: "12 ud", "6 huevos", "4 yogures". */
const COUNT_WORDS = [
  'unidades', 'unidad', 'unids', 'unid', 'unds', 'und', 'uds', 'ud', 'u',
  'piezas', 'pieza', 'pzas', 'pza', 'huevos', 'huevo', 'rollos', 'rollo', 'sobres', 'bolsitas',
  'capsulas', 'monodosis', 'yogures', 'latas', 'botellas', 'botellines', 'briks', 'bricks', 'tarrinas',
];

/** Containers that may sit between a count and a measure: "6 latas 33 cl", "6 latas de 33 cl". */
const CONTAINER_WORDS = [
  'latas', 'botellas', 'botellines', 'briks', 'bricks', 'tarros', 'botes', 'envases', 'sobres', 'bolsas',
  'paquetes', 'yogures', 'tarrinas', 'bandejas',
];
/**
 * Bare piece words need an explicit "x" or "de" before the measure: "4 ud x 125 g"
 * is four pieces of 125 g, but "12 ud 730 g" (eggs) is a box that weighs 730 g.
 */
const PIECE_WORDS = ['unidades', 'unidad', 'uds', 'ud', 'u', 'piezas'];

const byLengthDesc = (a: string, b: string) => b.length - a.length;
const MEASURE_RE = Object.keys(MEASURE_UNITS).sort(byLengthDesc).join('|');
const COUNT_RE = [...COUNT_WORDS].sort(byLengthDesc).join('|');
const CONTAINER_RE = [...CONTAINER_WORDS].sort(byLengthDesc).join('|');
const PIECE_RE = [...PIECE_WORDS].sort(byLengthDesc).join('|');
/** A number: "1", "1.5" (decimal commas are turned into dots first), "1.000", "1/2". */
const NUM = '(\\d+(?:\\.\\d+)*(?:\\/\\d+)?)';
const INT = '(\\d{1,3})';
/** Not glued to a previous word or number. */
const START = '(?<![a-z0-9.])';
const UNIT_END = '(?![a-z])';

const RE = {
  // "2 x 6 x 33 cl"
  multi2: new RegExp(`${START}${INT}\\s*x\\s*${INT}\\s*x\\s*${NUM}\\s*(${MEASURE_RE})${UNIT_END}`),
  // "6 x 1 l", "6x1l", "pack 6 x 200 ml"
  multi: new RegExp(`${START}${INT}\\s*x\\s*${NUM}\\s*(${MEASURE_RE})${UNIT_END}`),
  // "6 latas de 33 cl", "6 botellas 1.5 l"
  container: new RegExp(`${START}${INT}\\s*(?:${CONTAINER_RE})${UNIT_END}\\s*(?:x|de)?\\s*${NUM}\\s*(${MEASURE_RE})${UNIT_END}`),
  // "4 ud x 125 g", "6 unidades de 200 ml"
  pieces: new RegExp(`${START}${INT}\\s*(?:${PIECE_RE})${UNIT_END}\\s*(?:x|de)\\s*${NUM}\\s*(${MEASURE_RE})${UNIT_END}`),
  // "125 g x 4", "1 l pack 6", "33 cl pack de 12"
  reversed: new RegExp(`${START}${NUM}\\s*(${MEASURE_RE})${UNIT_END}\\s*(?:x|pack(?:\\s*de)?)\\s*${INT}(?![\\d.])(?!\\s*(?:${MEASURE_RE})${UNIT_END})`),
  // "pack 6 ..." / "pack de 6 ..." when the number is a count, not a measure.
  packCount: new RegExp(`(?<![a-z])pack\\s*(?:de\\s*)?${INT}(?![\\d.])(?!\\s*x)(?!\\s*(?:${MEASURE_RE})${UNIT_END})`),
  // "500 g", "1.5 kg", "6000ml"
  single: new RegExp(`${START}${NUM}\\s*(${MEASURE_RE})${UNIT_END}`),
  // "3 x 4 ud"
  multiCount: new RegExp(`${START}${INT}\\s*x\\s*(\\d{1,4})\\s*(?:${COUNT_RE})${UNIT_END}`),
  // "12 ud", "6 huevos"
  count: new RegExp(`${START}(\\d{1,4})\\s*(?:${COUNT_RE})${UNIT_END}`),
  dozens: /(?<![a-z0-9.])(\d{1,2})\s*docenas?(?![a-z])/,
  dozenAndHalf: /(?<![a-z])docena\s+y\s+media(?![a-z])/,
  halfDozen: /(?<![a-z])media\s+docena(?![a-z])/,
  dozen: /(?<![a-z])docena(?![a-z])/,
  halfMeasure: /(?<![a-z])medio\s+(kilo|litro)(?![a-z])/,
  quarterMeasure: /(?<![a-z])cuarto\s+(?:de\s+)?(kilo|litro)(?![a-z])/,
  // A size text that is only a unit: "kg", "1 kg" is caught above; "/kg", "por kg", "unidad".
  bareMeasure: /^(?:\/|por|el|al)?\s*(kg|kilo|kilogramo|l|litro|lt)$/,
  bareCount: /^(?:\/|por|la)?\s*(ud|u|und|unidad|pieza|pza)$/,
};

function normaliseSizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[\u00d7*]/g, ' x ')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parses "1.5", "1.000" (thousands, only for small units) and "1/2". */
function parseNumber(raw: string, factor: number): number | null {
  let s = raw;
  let divisor = 1;
  const slash = s.indexOf('/');
  if (slash >= 0) {
    divisor = Number(s.slice(slash + 1));
    s = s.slice(0, slash);
    if (!divisor) return null;
  }
  // "1.000 g" or "1.500 ml": a Spanish thousands separator, not a decimal point.
  if (/^\d{1,3}(?:\.\d{3})+$/.test(s) && factor <= 10) s = s.replace(/\./g, '');
  else if ((s.match(/\./g) ?? []).length > 1) return null;
  const n = Number(s) / divisor;
  return Number.isFinite(n) ? n : null;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function measure(rawNum: string, rawUnit: string): { amount: number; unit: BaseUnit } | null {
  const u = MEASURE_UNITS[rawUnit];
  if (!u) return null;
  const n = parseNumber(rawNum, u[1]);
  if (n === null) return null;
  return { amount: round3(n * u[1]), unit: u[0] };
}

function makeSize(count: number, amount: number, unit: BaseUnit): Size | null {
  if (!Number.isInteger(count) || count < 1 || count > 999) return null;
  if (!Number.isFinite(amount) || amount <= 0 || count * amount > 1e7) return null;
  return { count, amount, unit };
}

/** Finds a size anywhere in a normalised text; `loose` also accepts a bare unit ("kg"). */
function findSize(text: string, loose: boolean): Size | null {
  const t = normaliseSizeText(text);
  if (!t) return null;
  let m: RegExpMatchArray | null;

  if ((m = t.match(RE.multi2))) {
    const ms = measure(m[3]!, m[4]!);
    if (ms) return makeSize(Number(m[1]) * Number(m[2]), ms.amount, ms.unit);
  }
  if ((m = t.match(RE.multi))) {
    const ms = measure(m[2]!, m[3]!);
    if (ms) return makeSize(Number(m[1]), ms.amount, ms.unit);
  }
  if ((m = t.match(RE.container) ?? t.match(RE.pieces))) {
    const ms = measure(m[2]!, m[3]!);
    if (ms) return makeSize(Number(m[1]), ms.amount, ms.unit);
  }
  if ((m = t.match(RE.reversed))) {
    const ms = measure(m[1]!, m[2]!);
    if (ms) return makeSize(Number(m[3]), ms.amount, ms.unit);
  }
  const single = t.match(RE.single);
  if (single) {
    const ms = measure(single[1]!, single[2]!);
    if (ms) {
      const pack = t.match(RE.packCount);
      const count = pack ? Number(pack[1]) : 1;
      return makeSize(count >= 1 ? count : 1, ms.amount, ms.unit);
    }
  }
  if ((m = t.match(RE.halfMeasure))) return makeSize(1, 500, m[1] === 'kilo' ? 'g' : 'ml');
  if ((m = t.match(RE.quarterMeasure))) return makeSize(1, 250, m[1] === 'kilo' ? 'g' : 'ml');
  if ((m = t.match(RE.multiCount))) return makeSize(Number(m[1]), Number(m[2]), 'ud');
  if ((m = t.match(RE.count))) return makeSize(1, Number(m[1]), 'ud');
  if ((m = t.match(RE.dozens))) return makeSize(1, Number(m[1]) * 12, 'ud');
  if (RE.dozenAndHalf.test(t)) return makeSize(1, 18, 'ud');
  if (RE.halfDozen.test(t)) return makeSize(1, 6, 'ud');
  if (RE.dozen.test(t)) return makeSize(1, 12, 'ud');
  if (loose) {
    if ((m = t.match(RE.bareMeasure))) return makeSize(1, 1000, m[1]!.startsWith('k') ? 'g' : 'ml');
    if (RE.bareCount.test(t)) return makeSize(1, 1, 'ud');
  }
  return null;
}

/**
 * Parses a size as a chain or Open Food Facts writes it: "1 L", "1,5 kg",
 * "6 x 1 L", "Pack 6 x 200 ml", "33 cl", "12 ud", "docena", "garrafa 5 l".
 * Returns null when no size can be read.
 */
export function parseSize(text: string | null | undefined): Size | null {
  if (typeof text !== 'string') return null;
  return findSize(text, true);
}

/** Finds a size inside a product name: "Leche entera Hacendado 6 x 1 L". */
export function sizeFromName(name: string): Size | null {
  if (typeof name !== 'string') return null;
  return findSize(name, false);
}

export function totalAmount(s: Size): number {
  return round3(s.count * s.amount);
}

/** The unit prices are quoted in: g -> kg, ml -> l, ud -> ud. */
export function priceUnitOf(u: BaseUnit): PriceUnit {
  return u === 'g' ? 'kg' : u === 'ml' ? 'l' : 'ud';
}

/** Price per kg, l or unit, in whole cents; null without a usable size or price. */
export function unitPriceCents(priceCents: number, size: Size | null): { cents: number; unit: PriceUnit } | null {
  if (!size || !Number.isFinite(priceCents) || priceCents < 0) return null;
  const total = totalAmount(size);
  if (!(total > 0)) return null;
  const perBase = size.unit === 'ud' ? priceCents / total : (priceCents * 1000) / total;
  return { cents: Math.round(perBase), unit: priceUnitOf(size.unit) };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "1,5", "12", "0,33": at most `decimals` decimals, no trailing zeros, comma separator. */
export function formatNumber(n: number, decimals = 2): string {
  if (!Number.isFinite(n)) return '-';
  const fixed = Math.abs(n).toFixed(decimals);
  const [int, frac = ''] = fixed.split('.');
  const trimmed = frac.replace(/0+$/, '');
  const sign = n < 0 && Number(fixed) !== 0 ? '-' : '';
  return `${sign}${groupThousands(int!)}${trimmed ? `,${trimmed}` : ''}`;
}

/** es-ES groups thousands with a dot only from five digits on ("1234", "12.345"). */
function groupThousands(int: string): string {
  if (int.length < 5) return int;
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** "1,23 EUR" (euro sign) with a non-breaking space before the sign; "-0,50 EUR" for negatives. */
export function formatEuros(cents: number): string {
  if (!Number.isFinite(cents)) return `-${NBSP}€`;
  const rounded = Math.round(Math.abs(cents));
  const euros = Math.floor(rounded / 100);
  const rest = rounded % 100;
  const sign = cents < 0 && rounded > 0 ? '-' : '';
  return `${sign}${groupThousands(String(euros))},${String(rest).padStart(2, '0')}${NBSP}€`;
}

const UNIT_LABEL: Record<PriceUnit, string> = { kg: 'kg', l: 'L', ud: 'ud' };

/** "0,89 EUR/L", "4,04 EUR/kg", "0,25 EUR/ud" (euro sign, non-breaking space). */
export function formatUnitPrice(cents: number, unit: PriceUnit): string {
  return `${formatEuros(cents)}/${UNIT_LABEL[unit]}`;
}

/** One amount in its friendliest unit: 1500 ml -> "1,5 L", 330 ml -> "330 ml", 12 ud -> "12 ud". */
export function formatAmount(amount: number, unit: BaseUnit): string {
  if (unit === 'g') return amount >= 1000 ? `${formatNumber(amount / 1000, 3)} kg` : `${formatNumber(amount, 1)} g`;
  if (unit === 'ml') return amount >= 1000 ? `${formatNumber(amount / 1000, 3)} L` : `${formatNumber(amount, 1)} ml`;
  return `${formatNumber(amount, 2)} ud`;
}

/** "6 x 1 L" (with a multiplication sign), "500 g", "1,5 kg", "12 ud", "3 x 4 ud". */
export function formatSize(s: Size): string {
  const one = formatAmount(s.amount, s.unit);
  return s.count > 1 ? `${s.count} \u00d7 ${one}` : one;
}
