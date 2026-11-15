/** UI formatting helpers on top of @shared/units. */
import type { Offer } from '@shared/types';
import { formatUnitPrice } from '@shared/units';
import { offerUnitPrice } from '@shared/equiv';

export { formatEuros, formatSize, formatUnitPrice } from '@shared/units';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];

/** "12 oct" (adds the year when it is not the current one). */
export function shortDate(iso: string, now = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const label = `${Number(d)} ${MONTHS[Number(mo) - 1] ?? ''}`;
  return Number(y) === now.getFullYear() ? label : `${label} ${y}`;
}

export function daysSince(iso: string, now = new Date()): number {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(t) ? Math.floor((now.getTime() - t) / 86_400_000) : 0;
}

export const STALE_DAYS = 30;

export function unitPriceLabel(o: Offer): string | null {
  const u = offerUnitPrice(o);
  return u ? formatUnitPrice(u.cents, u.unit) : null;
}

export function plural(n: number, one: string, many: string) {
  return `${n} ${n === 1 ? one : many}`;
}

/** "Mercadona", "Mercadona y Aldi", "Mercadona, Aldi y Lidl". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/** A product name without its brand, for cards that show the brand on its own line. */
export function nameWithoutBrand(name: string, brand: string | null): string {
  if (!brand) return name;
  const esc = brand.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const out = name.replace(new RegExp(`(^|\\s)${esc}(?=\\s|$)`, 'i'), ' ').replace(/\s+/g, ' ').trim();
  return out.length >= 3 ? out : name;
}

export function greeting(now = new Date()): string {
  const h = now.getHours();
  if (h >= 6 && h < 14) return '¡Buenos días!';
  if (h >= 14 && h < 21) return '¡Buenas tardes!';
  return '¡Buenas noches!';
}
