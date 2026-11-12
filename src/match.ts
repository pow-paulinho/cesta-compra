/**
 * Which listings are the same product.
 *
 * An EAN is an identity: same EAN, same product (confidence "ean"). Without one,
 * a listing is matched on its normalised brand, name and size (confidence
 * "name"), which is shown to the user as a likely match, never as a certain one.
 */
export interface Listing { ean?: string | null; name: string; brand?: string | null; size?: string | null }
export type Confidence = 'ean' | 'name';

export function normalise(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/(\d)[.,](\d)/g, '$1.$2')
    .replace(/\b(\d+(?:\.\d+)?)\s*(kg|g|gr|grs|l|ml|cl)\b/g, (_m, n: string, u: string) => sizeKey(Number(n), u))
    .replace(/[^a-z0-9.]+/g, ' ')
    .trim();
}

function sizeKey(n: number, unit: string): string {
  const u = unit === 'gr' || unit === 'grs' ? 'g' : unit;
  if (u === 'kg') return `${n * 1000}g`;
  if (u === 'l') return `${n * 1000}ml`;
  if (u === 'cl') return `${n * 10}ml`;
  return `${n}${u}`;
}

export function matchKey(l: Listing): { key: string; confidence: Confidence } {
  const ean = (l.ean ?? '').replace(/\D/g, '');
  if (ean.length >= 8) return { key: `ean:${ean.padStart(13, '0')}`, confidence: 'ean' };
  const words = normalise(`${l.brand ?? ''} ${l.name} ${l.size ?? ''}`).split(' ').filter(Boolean).sort();
  return { key: `name:${[...new Set(words)].join(' ')}`, confidence: 'name' };
}

/** Groups listings that are the same product, keeping the weakest confidence seen in the group. */
export function group<T extends Listing>(listings: T[]): Array<{ key: string; confidence: Confidence; items: T[] }> {
  const groups = new Map<string, { key: string; confidence: Confidence; items: T[] }>();
  for (const l of listings) {
    const { key, confidence } = matchKey(l);
    const g = groups.get(key) ?? { key, confidence, items: [] };
    g.items.push(l);
    groups.set(key, g);
  }
  return [...groups.values()];
}
