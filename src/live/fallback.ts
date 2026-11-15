/**
 * Offers and product cards from the D1 catalogue (Open Prices, or the demo set in demo mode).
 *
 * Demo and real prices are never mixed: a request reads one source or the other, as the
 * checkout does. `prices.chain` holds the chain's catalogue name (shared/chains.ts:
 * CHAINS[id].catalogueName); rows of chains this app does not list (Dia, Consum, Eroski)
 * never become offers.
 *
 * Name matching uses LIKE with the term's own wildcards escaped (as src/api.ts does). Words
 * of four letters or more match with their vowels and n as single-character wildcards, so
 * "lasana" finds "Lasana" spelled with an n-tilde and accents never hide a product (SQLite's
 * lower() folds ASCII only). The ranking in shared/equiv.ts sorts out what that lets through.
 */
import { matchKey } from '../match';
import { CHAINS } from '../shared/chains';
import { normText, tokens } from '../shared/equiv';
import { CHAIN_IDS, type ChainId, type Offer, type Product, type WantedProduct } from '../shared/types';
import { parseSize, sizeFromName, unitPriceCents } from '../shared/units';

export type CatalogueSource = 'open_prices' | 'demo';

export interface CatalogueRow {
  ean: string;
  name: string;
  brand: string | null;
  size: string | null;
  chain: string | null;
  source: string | null;
  price_cents: number | null;
  observed_on: string | null;
}

/** Most rows one hunt reads, across all chains. */
export const HUNT_ROW_LIMIT = 160;
/** Most products one catalogue search returns. */
export const SEARCH_PRODUCT_LIMIT = 30;
/** Most words a name match ANDs together. */
export const MAX_LIKE_WORDS = 3;

const CHAIN_BY_NAME = new Map<string, ChainId>(CHAIN_IDS.map((id) => [normText(CHAINS[id].catalogueName), id]));

/** The chain id for a catalogue chain name ("El Corte Ingles" with or without accent), or null. */
export function chainIdOf(catalogueName: string | null | undefined): ChainId | null {
  return CHAIN_BY_NAME.get(normText(catalogueName)) ?? null;
}

const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);

/** A LIKE pattern for one normalised word (see the header for the wildcard rule). */
export function wordPattern(word: string): string {
  const w = word.toLowerCase();
  if (w.length < 4) return `%${escapeLike(w)}%`;
  let out = '';
  for (const ch of w) out += /[aeioun]/.test(ch) ? '_' : escapeLike(ch);
  return `%${out}%`;
}

/**
 * The LIKE patterns a text is matched with: its first significant words (no stop words, no
 * sizes, at least 3 letters), at most `max`. A text made only of short words is matched as
 * it was typed.
 */
export function likePatterns(text: string, max = MAX_LIKE_WORDS, exclude: string[] = []): string[] {
  const skip = new Set(exclude);
  const words = tokens(text).filter((w) => w.length >= 3 && !skip.has(w)).slice(0, max);
  if (words.length) return words.map(wordPattern);
  const raw = text.trim().toLowerCase();
  return raw.length >= 2 ? [`%${escapeLike(raw)}%`] : [];
}

/** The ways an EAN may be stored: as given, padded to 13 digits, without leading zeros. */
export function eanVariants(ean: string | null | undefined): string[] {
  const digits = (ean ?? '').replace(/\D/g, '');
  if (!/^\d{8,14}$/.test(digits)) return [];
  const out = new Set<string>([digits]);
  if (digits.length < 13) out.add(digits.padStart(13, '0'));
  const bare = digits.replace(/^0+/, '');
  if (bare.length >= 8) out.add(bare);
  if (bare.length < 13 && bare.length >= 8) out.add(bare.padStart(13, '0'));
  return [...out];
}

/** Numbered SQL parameters (?1, ?2, ...) collected while a query is built. */
class Params {
  readonly values: unknown[] = [];
  add(v: unknown): string {
    this.values.push(v);
    return `?${this.values.length}`;
  }
  list(vs: readonly unknown[]): string {
    return vs.map((v) => this.add(v)).join(', ');
  }
}

/** Every pattern must match the name or the brand. */
function wordsClause(p: Params, patterns: string[]): string {
  return patterns
    .map((pat) => {
      const ref = p.add(pat);
      return `(lower(p.name) LIKE ${ref} ESCAPE '\\' OR lower(coalesce(p.brand, '')) LIKE ${ref} ESCAPE '\\')`;
    })
    .join(' AND ');
}

/** A catalogue row with a price as an Offer of one of our chains; null otherwise. */
export function rowToOffer(row: CatalogueRow): Offer | null {
  const chain = chainIdOf(row.chain);
  if (!chain || typeof row.price_cents !== 'number' || !(row.price_cents > 0) || !row.observed_on) return null;
  if (row.source !== 'open_prices' && row.source !== 'demo') return null;
  const size = parseSize(row.size) ?? sizeFromName(row.name);
  const unit = unitPriceCents(row.price_cents, size);
  return {
    chain,
    id: row.ean,
    name: row.name,
    brand: row.brand,
    ean: row.ean,
    sizeText: row.size,
    priceCents: row.price_cents,
    unitPriceCents: unit?.cents ?? null,
    unit: unit?.unit ?? null,
    image: null,
    url: null,
    promo: null,
    source: row.source,
    observedOn: row.observed_on.slice(0, 10),
  };
}

const SELECT_ROWS = 'SELECT p.ean, p.name, p.brand, p.size, x.chain, x.source, x.price_cents, x.observed_on';

async function huntRows(db: D1Database, chains: ChainId[], source: CatalogueSource, match: (p: Params) => string): Promise<CatalogueRow[]> {
  const p = new Params();
  const src = p.add(source);
  const names = p.list(chains.map((c) => CHAINS[c].catalogueName));
  const where = match(p);
  const sql = `${SELECT_ROWS} FROM prices x JOIN products p ON p.ean = x.ean
    WHERE x.source = ${src} AND x.chain IN (${names}) AND (${where})
    ORDER BY x.observed_on DESC, x.price_cents LIMIT ${HUNT_ROW_LIMIT}`;
  const res = await db.prepare(sql).bind(...p.values).all<CatalogueRow>();
  return res.results ?? [];
}

export interface FallbackOptions {
  source?: CatalogueSource;
  mode?: 'exact' | 'equivalent';
}

/**
 * Offers from D1 for the wanted product, per chain. By EAN when one is known; by name for
 * the chains the EAN did not find (exact mode) or always (equivalent mode, where another
 * brand is welcome). Brand words leave the name match in equivalent mode.
 */
export async function fallbackOffers(
  db: D1Database,
  wanted: WantedProduct,
  chains: ChainId[],
  opts: FallbackOptions = {},
): Promise<Partial<Record<ChainId, Offer[]>>> {
  const source = opts.source ?? 'open_prices';
  const mode = opts.mode ?? 'exact';
  const out: Partial<Record<ChainId, Offer[]>> = {};
  const targets = [...new Set(chains)];
  if (!targets.length) return out;
  const seen = new Set<string>();
  const take = (rows: CatalogueRow[]) => {
    for (const row of rows) {
      const offer = rowToOffer(row);
      if (!offer || !targets.includes(offer.chain)) continue;
      const k = `${offer.chain}|${offer.id}`;
      if (seen.has(k)) continue;
      seen.add(k);
      (out[offer.chain] ??= []).push(offer);
    }
  };

  const eans = eanVariants(wanted.ean);
  if (eans.length) take(await huntRows(db, targets, source, (p) => `p.ean IN (${p.list(eans)})`));

  const byName = mode === 'equivalent' ? targets : targets.filter((c) => !out[c]?.length);
  if (byName.length) {
    const brandWords = mode === 'equivalent' ? tokens(wanted.brand ?? '') : [];
    const patterns = likePatterns(wanted.name, MAX_LIKE_WORDS, brandWords);
    if (patterns.length) take(await huntRows(db, byName, source, (p) => wordsClause(p, patterns)));
  }
  return out;
}

/**
 * Product cards from the catalogue for a search: products whose name or brand has every
 * significant word of the query (or whose EAN is the query), each with its prices from the
 * chosen source. Products without such prices still come back, without offers.
 */
export async function catalogueSearch(db: D1Database, q: string, source: CatalogueSource = 'open_prices'): Promise<Product[]> {
  const term = q.trim();
  const p = new Params();
  const src = p.add(source);
  const eans = /^\d{8,14}$/.test(term) ? eanVariants(term) : [];
  let where: string;
  if (eans.length) {
    where = `ean IN (${p.list(eans)})`;
  } else {
    const patterns = likePatterns(term, 4);
    if (!patterns.length) return [];
    where = patterns
      .map((pat) => {
        const ref = p.add(pat);
        return `(lower(name) LIKE ${ref} ESCAPE '\\' OR lower(coalesce(brand, '')) LIKE ${ref} ESCAPE '\\')`;
      })
      .join(' AND ');
  }
  const sql = `${SELECT_ROWS} FROM products p LEFT JOIN prices x ON x.ean = p.ean AND x.source = ${src}
    WHERE p.ean IN (SELECT ean FROM products WHERE ${where} LIMIT ${SEARCH_PRODUCT_LIMIT})
    ORDER BY p.name, x.price_cents`;
  const res = await db.prepare(sql).bind(...p.values).all<CatalogueRow>();

  const byEan = new Map<string, Product>();
  for (const row of res.results ?? []) {
    let product = byEan.get(row.ean);
    if (!product) {
      product = {
        key: matchKey({ ean: row.ean, name: row.name, brand: row.brand, size: row.size }).key,
        name: row.name,
        brand: row.brand,
        sizeText: row.size,
        ean: row.ean,
        image: null,
        offers: [],
      };
      byEan.set(row.ean, product);
    }
    const offer = rowToOffer(row);
    if (offer && !product.offers.some((o) => o.chain === offer.chain)) product.offers.push(offer);
  }
  const products = [...byEan.values()];
  for (const pr of products) pr.offers.sort((a, b) => a.priceCents - b.priceCents);
  // Products with prices first, then by name.
  products.sort((a, b) => Number(b.offers.length > 0) - Number(a.offers.length > 0) || a.name.localeCompare(b.name, 'es'));
  return products;
}
