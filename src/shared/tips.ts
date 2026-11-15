/**
 * Saving tips, in Spanish, computed from the cart and its plan.
 *
 * Pure and deterministic: the same items, plan and `now` give the same tips.
 * Tips with a saving come first (biggest first); the rest keep a fixed
 * priority (missing prices, demo prices, stale prices, promos, leftovers,
 * unit prices). At most 6.
 */
import { CHAINS } from './chains';
import type { ChainId, Offer } from './types';
import { costFor, isOwnBrand, offerSize, offerUnitPrice, ownBrandOf, STOP_WORDS, wantedSize } from './equiv';
import type { Optimisation, PlanItem, PlanResult, StopLine } from './optimize';
import { formatEuros, formatSize, formatUnitPrice, NBSP, totalAmount } from './units';

export interface Tip {
  id: string;
  icon: string;
  title: string;
  body: string;
  savingCents?: number;
}

const MAX_TIPS = 6;
const MIN_TIPS = 3;
const STALE_DAYS = 30;
const DAY_MS = 86_400_000;

const chainName = (c: ChainId) => CHAINS[c]?.name ?? c;

/** "Mercadona", "Mercadona y Aldi", "Mercadona, Aldi y Lidl". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** A short, lowercase noun for an item: "Aceite de oliva Carbonell 1 L" -> "aceite". */
function shortNoun(item: PlanItem): string {
  const brandWords = new Set(
    (item.wanted.brand ?? '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .split(/[^a-z0-9]+/)
      .filter(Boolean),
  );
  const source = item.wanted.name || item.name;
  for (const raw of source.split(/\s+/)) {
    const word = raw.replace(/[^\p{L}\p{N}-]/gu, '');
    const plain = word.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!word || /\d/.test(word) || STOP_WORDS.has(plain) || brandWords.has(plain)) continue;
    return word.toLowerCase();
  }
  return item.name.toLowerCase();
}

function planLines(p: PlanResult | null | undefined): Array<StopLine & { chain: ChainId }> {
  return (p?.stops ?? []).flatMap((s) => s.lines.map((l) => ({ ...l, chain: s.chain })));
}

/** Days from an ISO date (YYYY-MM-DD) to `now`, or null when the date is unreadable. */
function ageDays(isoDate: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate ?? '');
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - t) / DAY_MS);
}

/** End date of a promo text ("Oferta hasta 21/11", "hasta el 3/12/2026"), as days from `now` and "dd/mm". */
function promoEnd(promo: string, now: Date): { days: number; label: string } | null {
  const m = /(?:hasta|acaba|termina|fin)\D{0,12}?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/i.exec(promo);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let year = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : now.getUTCFullYear();
  let end = Date.UTC(year, month - 1, day);
  // Without a year, a date long gone means next year ("hasta 05/01" seen in December).
  if (!m[3] && end < today - 180 * DAY_MS) end = Date.UTC(++year, month - 1, day);
  const days = Math.round((end - today) / DAY_MS);
  if (days < 0) return null;
  return { days, label: `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}` };
}

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

// ---------------------------------------------------------------------------
// Individual tips
// ---------------------------------------------------------------------------

/**
 * Singles that have every item some chain has. Items no chain prices are
 * missing everywhere, so they must not hide a comparison between chains.
 */
function fullSingles(opt: Optimisation): Optimisation['singles'] {
  const nowhere = opt.byCap.all.missing.length;
  return opt.singles.filter((s) => s.stores > 0 && s.missing.length === nowhere);
}

function splitTip(opt: Optimisation): Tip | null {
  const { split } = opt;
  if (split.stores < 2 || split.missing.length !== opt.byCap.all.missing.length) return null;
  const bestSingle = opt.bestSingle ?? fullSingles(opt)[0] ?? null;
  if (!bestSingle) return null;
  const savingCents = bestSingle.totalCents - split.totalCents;
  if (savingCents <= 0) return null;
  const perExtra = Math.round(savingCents / (split.stores - 1));
  const tail = split.stores > 2 ? ` Son unos ${formatEuros(perExtra)} por cada súper de más.` : '';
  return {
    id: 'split',
    icon: '🛒',
    title: 'Reparte la compra',
    body: `Repartir en ${split.stores} súper te ahorra ${formatEuros(savingCents)} (${pct(savingCents, bestSingle.totalCents)}${NBSP}%) frente a comprarlo todo en ${chainName(bestSingle.chain)}.${tail}`,
    savingCents,
  };
}

function singleTip(opt: Optimisation): Tip | null {
  const full = fullSingles(opt);
  const itemCount = opt.split.stops.reduce((n, s) => n + s.lines.length, 0) + opt.split.missing.length;
  const coverable = itemCount - opt.byCap.all.missing.length;
  if (coverable <= 0) return null;
  if (full.length >= 2) {
    const [best, second] = full as [typeof full[number], typeof full[number]];
    const diff = second.totalCents - best.totalCents;
    if (diff <= 0) return null;
    return {
      id: 'single',
      icon: '🏆',
      title: 'Si solo vas a un súper',
      body: `Elige ${chainName(best.chain)}: ${opt.byCap.all.missing.length ? 'todo lo que tiene precio' : 'todo'} por ${formatEuros(best.totalCents)}, ${formatEuros(diff)} menos que en ${chainName(second.chain)}.`,
      savingCents: diff,
    };
  }
  if (full.length === 0) {
    const top = opt.singles[0];
    if (!top || top.stores === 0) return null;
    const has = itemCount - top.missing.length;
    return {
      id: 'coverage',
      icon: '🧩',
      title: 'Ningún súper lo tiene todo',
      body: `El que más tiene es ${chainName(top.chain)}: ${has} de ${coverable} productos con precio. Para el resto tendrás que ir a otro.`,
    };
  }
  return null;
}

function moreStoresTip(opt: Optimisation): Tip | null {
  const { split } = opt;
  const all = opt.byCap.all;
  const delta = split.totalCents - all.totalCents;
  if (all.stores <= split.stores || all.missing.length > split.missing.length || delta < 50) return null;
  const now = new Set(split.stops.map((s) => s.chain));
  const then = new Set(all.stops.map((s) => s.chain));
  const added = all.stops.map((s) => s.chain).filter((c) => !now.has(c));
  // The bigger plan may leave out a store of the current one: then it is a swap, not "also".
  const dropped = split.stops.map((s) => s.chain).filter((c) => !then.has(c));
  if (!added.length) return null;
  const body = dropped.length
    ? `Si cambias ${joinNames(dropped.map(chainName))} por ${joinNames(added.map(chainName))}, ahorras ${formatEuros(delta)} más.`
    : `Si pasas también por ${joinNames(added.map(chainName))}, ahorras otros ${formatEuros(delta)}.`;
  return {
    id: 'more-stores',
    icon: '🗺️',
    title: plural(all.stores - split.stores, 'Un súper más compensa', 'Ir a más súper compensa'),
    body,
    savingCents: delta,
  };
}

/** Nouns for a short list: "aceite", "aceite y leche", "aceite, leche y pan", "4 productos". */
function nounList(items: PlanItem[]): string {
  return items.length <= 3 ? joinNames(items.map(shortNoun)) : `${items.length} productos`;
}

/**
 * Own brands, measured against what the plan buys (the split):
 * - 'own-brand' (a saving to chase): an own-brand offer costs less than the
 *   branded one the plan buys for an item;
 * - 'own-brand-done' (no saving to chase, it is in the plan already): the plan
 *   buys an own brand, and that costs less than the cheapest branded offer.
 * A saving the plan already makes is never offered again as a switch.
 */
function ownBrandTips(items: PlanItem[], opt: Optimisation): Tip[] {
  const lines = new Map(planLines(opt.split).map((l) => [l.itemId, l]));
  const wins: Array<{ item: PlanItem; saving: number; own: Offer; ownLabel: string; brand: string }> = [];
  const done: Array<{ item: PlanItem; saving: number }> = [];
  for (const item of items) {
    const line = lines.get(item.id);
    if (!line || !(item.qty > 0) || isOwnBrand(item.wanted.brand)) continue;
    const size = wantedSize(item.wanted);
    const priced = Object.values(item.offers)
      .filter((o): o is Offer => !!o && o.priceCents > 0)
      .map((offer) => ({ offer, cents: costFor(offer, size, item.qty).cents, own: ownBrandOf(offer) }))
      .sort((a, b) => a.cents - b.cents || (a.offer.chain < b.offer.chain ? -1 : 1));
    if (ownBrandOf(line.offer)) {
      const branded = priced.find((p) => !p.own && p.offer.brand);
      if (branded && branded.cents > line.costCents) done.push({ item, saving: branded.cents - line.costCents });
      continue;
    }
    // Only a branded line has a brand to switch from (fruit, bread from the counter...).
    if (!line.offer.brand) continue;
    const own = priced.find((p) => p.own);
    if (own?.own && own.cents < line.costCents) {
      wins.push({ item, saving: line.costCents - own.cents, own: own.offer, ownLabel: own.own.label, brand: line.offer.brand });
    }
  }
  const byBiggest = <T extends { item: PlanItem; saving: number }>(a: T, b: T) => b.saving - a.saving || (a.item.id < b.item.id ? -1 : 1);
  const tips: Tip[] = [];
  if (wins.length) {
    wins.sort(byBiggest);
    const [top, ...rest] = wins as [typeof wins[number], ...typeof wins];
    const total = wins.reduce((sum, w) => sum + w.saving, 0);
    const label = top.ownLabel.toLowerCase() === chainName(top.own.chain).toLowerCase() ? '' : ` (${top.ownLabel})`;
    const more = rest.length
      ? ` Si también eliges marca blanca en ${rest.length <= 3 ? nounList(rest.map((w) => w.item)) : `otros ${rest.length} productos`}, el ahorro sube a ${formatEuros(total)}.`
      : '';
    tips.push({
      id: 'own-brand',
      icon: '🏷️',
      title: 'Cambia a marca blanca',
      body: `${chainName(top.own.chain)} tiene ${shortNoun(top.item)} de marca blanca${label} por ${formatEuros(top.saving)} menos que ${top.brand}.${more}`,
      savingCents: total,
    });
  }
  if (done.length) {
    done.sort(byBiggest);
    const total = done.reduce((sum, d) => sum + d.saving, 0);
    tips.push({
      id: 'own-brand-done',
      icon: '💪',
      title: 'Ya ahorras con la marca blanca',
      body: `Tu plan ya ahorra ${formatEuros(total)} gracias a la marca blanca en ${nounList(done.map((d) => d.item))}.`,
    });
  }
  return tips;
}

function missingTip(items: PlanItem[], opt: Optimisation): Tip | null {
  const ids = opt.split.missing;
  if (!ids.length) return null;
  const names = ids.map((id) => items.find((i) => i.id === id)?.name ?? id);
  const shown = names.slice(0, 3).join(', ') + (names.length > 3 ? `, y ${names.length - 3} más` : '');
  return {
    id: 'missing',
    icon: '🔍',
    title: plural(ids.length, 'Un producto sin precio', `${ids.length} productos sin precio`),
    body: `${plural(ids.length, 'No hemos encontrado precio', 'No hemos encontrado precios')} en ningún súper para: ${shown}. Prueba con «Me vale otra marca».`,
  };
}

/** Offers that feed the plans the user sees (split and best single), without repeats. */
function shownOffers(opt: Optimisation): Array<StopLine & { chain: ChainId }> {
  const seen = new Set<string>();
  return [...planLines(opt.split), ...planLines(opt.bestSingle)].filter((l) => {
    const key = `${l.chain}:${l.offer.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function demoTip(opt: Optimisation): Tip | null {
  const n = shownOffers(opt).filter((l) => l.offer.source === 'demo').length;
  if (!n) return null;
  return {
    id: 'demo',
    icon: '🧪',
    title: 'Precios de prueba',
    body: `${n} ${plural(n, 'precio es', 'precios son')} de demostración, no reales. Quita el modo demo para ver solo precios de verdad.`,
  };
}

function staleTip(opt: Optimisation, now: Date): Tip | null {
  const old = shownOffers(opt).filter((l) => {
    if (l.offer.source !== 'open_prices') return false;
    const age = ageDays(l.offer.observedOn, now);
    return age !== null && age > STALE_DAYS;
  });
  if (!old.length) return null;
  const n = old.length;
  return {
    id: 'stale',
    icon: '⏳',
    title: 'Precios antiguos',
    body: `${n} ${plural(n, 'precio', 'precios')} de Open Prices ${plural(n, 'tiene', 'tienen')} más de ${STALE_DAYS} días: ${plural(n, 'compruébalo', 'compruébalos')} en la tienda.`,
  };
}

function promoTip(items: PlanItem[], opt: Optimisation, now: Date): Tip | null {
  const dated = shownOffers(opt)
    .filter((l) => l.offer.promo)
    .map((l) => ({ line: l, end: promoEnd(l.offer.promo!, now) }))
    .filter((x): x is { line: StopLine & { chain: ChainId }; end: { days: number; label: string } } => x.end !== null)
    .sort((a, b) => a.end.days - b.end.days || (a.line.itemId < b.line.itemId ? -1 : 1));
  const first = dated[0];
  if (!first) return null;
  const item = items.find((i) => i.id === first.line.itemId);
  const what = item ? ` en ${shortNoun(item)}` : '';
  const when = first.end.days === 0 ? 'hoy' : first.end.days === 1 ? 'mañana' : `en ${first.end.days} días`;
  return {
    id: 'promo',
    icon: '⏰',
    title: 'Aprovecha la oferta',
    body: `La oferta de ${chainName(first.line.chain)}${what} acaba el ${first.end.label} (${when}).`,
  };
}

function leftoverTip(items: PlanItem[], opt: Optimisation): Tip | null {
  let best: { line: StopLine & { chain: ChainId }; share: number } | null = null;
  for (const line of planLines(opt.split)) {
    const size = offerSize(line.offer);
    const left = line.leftover;
    if (!size || !left || line.packs < 1) continue;
    const bought = totalAmount(size) * line.packs;
    const share = bought > 0 ? totalAmount(left) / bought : 0;
    if (share >= 0.2 && (!best || share > best.share)) best = { line, share };
  }
  if (!best) return null;
  const { line } = best;
  const size = offerSize(line.offer)!;
  const unit = offerUnitPrice(line.offer);
  const item = items.find((i) => i.id === line.itemId);
  const pack = size.count > 1 ? `El pack de ${size.count}` : `El formato de ${formatSize(size)}`;
  const price = unit ? ` sale a ${formatUnitPrice(unit.cents, unit.unit)}, pero` : '';
  const leftText = formatSize(line.leftover!);
  return {
    id: 'leftover',
    icon: '📦',
    title: 'Ojo con lo que sobra',
    body: `${pack}${item ? ` de ${shortNoun(item)}` : ''} en ${chainName(line.chain)}${price} te ${leftText.startsWith('1 ') ? 'sobra' : 'sobran'} ${leftText}. Cómpralo solo si lo vas a gastar.`,
  };
}

function unitPriceTip(items: PlanItem[]): Tip | null {
  let best: { item: PlanItem; cheap: Offer; good: Offer; ratio: number } | null = null;
  for (const item of items) {
    if (!(item.qty > 0)) continue;
    const priced = Object.values(item.offers)
      .filter((o): o is Offer => !!o && o.priceCents > 0)
      .map((o) => ({ o, u: offerUnitPrice(o) }))
      .filter((x): x is { o: Offer; u: NonNullable<ReturnType<typeof offerUnitPrice>> } => x.u !== null);
    if (priced.length < 2) continue;
    const unit = priced[0]!.u.unit;
    if (priced.some((x) => x.u.unit !== unit)) continue;
    const cheapPack = [...priced].sort((a, b) => a.o.priceCents - b.o.priceCents || (a.o.chain < b.o.chain ? -1 : 1))[0]!;
    const cheapUnit = [...priced].sort((a, b) => a.u.cents - b.u.cents || (a.o.chain < b.o.chain ? -1 : 1))[0]!;
    if (cheapPack.o === cheapUnit.o || cheapPack.u.cents <= cheapUnit.u.cents * 1.05) continue;
    const ratio = cheapPack.u.cents / Math.max(1, cheapUnit.u.cents);
    if (!best || ratio > best.ratio) best = { item, cheap: cheapPack.o, good: cheapUnit.o, ratio };
  }
  if (!best) return null;
  const cu = offerUnitPrice(best.cheap)!;
  const gu = offerUnitPrice(best.good)!;
  const per = cu.unit === 'kg' ? 'kilo' : cu.unit === 'l' ? 'litro' : 'unidad';
  return {
    id: 'unit-price',
    icon: '⚖️',
    title: `Mira el precio por ${per}, no el del envase`,
    body: `En ${chainName(best.cheap.chain)}, ${shortNoun(best.item)} cuesta ${formatEuros(best.cheap.priceCents)} el envase pero sale a ${formatUnitPrice(cu.cents, cu.unit)}; en ${chainName(best.good.chain)}, a ${formatUnitPrice(gu.cents, gu.unit)}.`,
  };
}

/** Used to reach MIN_TIPS when the data gives too few. */
const FILLERS: Tip[] = [
  {
    id: 'unit-price',
    icon: '⚖️',
    title: 'Mira el precio por kilo, no el del envase',
    body: 'Un envase más barato puede salir más caro por kilo o por litro. Compara siempre el €/kg o el €/L.',
  },
  {
    id: 'try-equivalent',
    icon: '🔄',
    title: 'Prueba «Me vale otra marca»',
    body: 'Si no te importa la marca, buscamos el equivalente más barato en cada súper.',
  },
  {
    id: 'add-more',
    icon: '➕',
    title: 'Cuantos más productos, mejor plan',
    body: 'Con 5 o más productos en la cesta se ve mejor qué súper te conviene.',
  },
];

/**
 * Concrete saving tips for this cart and plan: biggest saving first, at most 6.
 * `now` dates stale prices and promo ends; pass it for reproducible output.
 */
export function savingTips(items: PlanItem[], opt: Optimisation, now: Date = new Date()): Tip[] {
  const active = items.filter((i) => Number.isFinite(i.qty) && i.qty > 0);
  if (!active.length) return [];
  const own = ownBrandTips(active, opt);
  const ownBrand = own.find((t) => t.id === 'own-brand') ?? null;
  const ownBrandDone = own.find((t) => t.id === 'own-brand-done') ?? null;
  const candidates = [
    splitTip(opt),
    ownBrand,
    moreStoresTip(opt),
    missingTip(active, opt),
    singleTip(opt),
    demoTip(opt),
    staleTip(opt, now),
    promoTip(active, opt, now),
    leftoverTip(active, opt),
    unitPriceTip(active),
    ownBrandDone,
  ].filter((t): t is Tip => t !== null);

  const tips = candidates
    .map((t, i) => ({ t, i }))
    .sort((a, b) => (b.t.savingCents ?? -1) - (a.t.savingCents ?? -1) || a.i - b.i)
    .map((x) => x.t)
    .slice(0, MAX_TIPS);

  for (const filler of FILLERS) {
    if (tips.length >= MIN_TIPS) break;
    if (!tips.some((t) => t.id === filler.id)) tips.push(filler);
  }
  return tips;
}

/** Short, friendly tips the mascot rotates through. */
export const EVERGREEN_TIPS: Tip[] = [
  { id: 'eg-unit-price', icon: '⚖️', title: 'Precio por kilo', body: 'Compara el precio por kilo o por litro, no el del envase.' },
  { id: 'eg-own-brand', icon: '🏷️', title: 'Marca blanca', body: 'La marca blanca suele costar bastante menos. ¡Pruébala en lo básico!' },
  { id: 'eg-list', icon: '📝', title: 'Lleva lista', body: 'Haz la lista antes de salir: comprar sin lista casi siempre sale más caro.' },
  { id: 'eg-hungry', icon: '🍌', title: 'Con el estómago lleno', body: 'No vayas a comprar con hambre: acabarás con más caprichos en el carro.' },
  { id: 'eg-2x1', icon: '🎯', title: 'Ojo con el 2x1', body: 'Un 2x1 solo es un chollo si de verdad te lo vas a gastar.' },
  { id: 'eg-shelves', icon: '👀', title: 'Mira arriba y abajo', body: 'Lo más caro suele estar a la altura de los ojos. Echa un vistazo a las baldas de arriba y de abajo.' },
  { id: 'eg-season', icon: '🍊', title: 'Fruta de temporada', body: 'La fruta y la verdura de temporada es más barata y sabe mejor.' },
  { id: 'eg-freeze', icon: '❄️', title: 'Congela en raciones', body: 'Congela el pan y la carne en raciones: tirarás menos comida.' },
  { id: 'eg-big-packs', icon: '📦', title: 'Packs grandes', body: 'Un pack grande solo compensa si no se te pone malo antes de gastarlo.' },
  { id: 'eg-split', icon: '🗺️', title: 'Dos súper, más ahorro', body: 'Si te pillan de camino, repartir la compra entre dos súper puede ahorrarte unos euros.' },
];
