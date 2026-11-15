/**
 * Offers and product cards from the D1 catalogue (Open Prices, or the demo set in demo mode).
 *
 * Demo and real prices are never mixed: a request reads one source or the other, as the
 * checkout does. `prices.chain` holds the chain's catalogue name (shared/chains.ts:
 * CHAINS[id].catalogueName); rows of chains this app does not list (Dia, Consum, Eroski)
 * never become offers.
 *
 * Name matching uses LIKE with the term's own wildcards escaped (as src/api.ts does).
 *   - Hunts (fallbackOffers): words of four letters or more match with their vowels and n as
 *     single-character wildcards, so "lasana" finds "Lasana" spelled with an n-tilde and
 *     accents never hide a product (SQLite's lower() folds ASCII only). The ranking in
 *     shared/equiv.ts sorts out what that lets through, and each chain gets its own rows.
 *   - Searches (catalogueSearch): the product text is folded in SQL as normText folds the
 *     query (accents, n-tilde, case), so a word matches only itself, and the products shown
 *     are chosen priced first before the cut.
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

/** Most rows one hunt reads per chain (the newest, then the cheapest). */
export const HUNT_ROWS_PER_CHAIN = 40;
/** Most rows one hunt reads in all: a safety net, never smaller than every chain's share. */
export const HUNT_ROW_LIMIT = HUNT_ROWS_PER_CHAIN * CHAIN_IDS.length;
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
  // The limit applies per chain, so chains with older observations still get their rows.
  const sql = `SELECT ean, name, brand, size, chain, source, price_cents, observed_on FROM (
      ${SELECT_ROWS}, ROW_NUMBER() OVER (PARTITION BY x.chain ORDER BY x.observed_on DESC, x.price_cents) AS rn
      FROM prices x JOIN products p ON p.ean = x.ean
      WHERE x.source = ${src} AND x.chain IN (${names}) AND (${where})
    ) WHERE rn <= ${HUNT_ROWS_PER_CHAIN}
    ORDER BY observed_on DESC, price_cents LIMIT ${HUNT_ROW_LIMIT}`;
  const res = await db.prepare(sql).bind(...p.values).all<CatalogueRow>();
  return res.results ?? [];
}

export interface FallbackOptions {
  source?: CatalogueSource;
  mode?: 'exact' | 'equivalent';
}

/**
 * Offers from D1 for the wanted product, per chain. By EAN when one is known; by name for
 * the chains the EAN did not find (exact mode, where the brand must match too) or always
 * (equivalent mode, where another brand is welcome and brand words leave the name match).
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
    const brandWords = tokens(wanted.brand ?? '').filter((w) => w.length >= 3);
    const patterns = likePatterns(wanted.name, MAX_LIKE_WORDS, mode === 'equivalent' ? brandWords : []);
    // Exact mode also needs the brand (in the name or the brand column), so a common
    // product ("leche") does not fill the row limit with other brands.
    if (mode === 'exact' && brandWords.length) {
      const brand = wordPattern(brandWords[0]!);
      if (!patterns.includes(brand)) patterns.push(brand);
    }
    if (patterns.length) take(await huntRows(db, byName, source, (p) => wordsClause(p, patterns)));
  }
  return out;
}

/** Accented and special letters SQLite's lower() leaves alone, as normText folds them. */
const SQL_FOLDS: Array<[string, string]> = [
  ...[...'áàäâÁÀÄÂ'].map((c): [string, string] => [c, 'a']),
  ...[...'éèëêÉÈËÊ'].map((c): [string, string] => [c, 'e']),
  ...[...'íìïîÍÌÏÎ'].map((c): [string, string] => [c, 'i']),
  ...[...'óòöôÓÒÖÔ'].map((c): [string, string] => [c, 'o']),
  ...[...'úùüûÚÙÜÛ'].map((c): [string, string] => [c, 'u']),
  ['ñ', 'n'], ['Ñ', 'n'], ['ç', 'c'], ['Ç', 'c'],
  ["'", ''], ['\u2019', ''],
  ...[...'-/.,()"'].map((c): [string, string] => [c, ' ']),
];
/** Combining marks of decomposed text (acute, grave, circumflex, tilde, diaeresis). */
const SQL_COMBINING = [769, 768, 770, 771, 776];

/** SQL for `expr` lowercased, without accents, ñ as n, apostrophes dropped and other punctuation as spaces. */
export function foldSql(expr: string): string {
  let e = `lower(${expr})`;
  for (const [from, to] of SQL_FOLDS) e = `replace(${e}, '${from === "'" ? "''" : from}', '${to}')`;
  for (const code of SQL_COMBINING) e = `replace(${e}, char(${code}), '')`;
  return e;
}

/** "huevos" -> "huevo", "limones" -> "limon": the shorter form also finds the singular. */
function searchStem(w: string): string {
  if (w.length > 4 && w.endsWith('es') && /[lnrdzj]/.test(w[w.length - 3]!)) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) return w.slice(0, -1);
  return w;
}

/**
 * The words a catalogue search matches, folded as normText folds them: the query's
 * significant words (at most `max`), or, when it only has short words, those.
 */
export function searchWords(q: string, max = 4): string[] {
  const words = tokens(q).filter((w) => w.length >= 3).slice(0, max);
  if (words.length) return words.map(searchStem);
  return normText(q).split(' ').filter((w) => w.length >= 2).slice(0, max);
}

/** How well a product answers the words: one point per word that starts a word of it. */
function relevance(product: { name: string; brand: string | null }, words: string[]): number {
  const text = ` ${normText(`${product.name} ${product.brand ?? ''}`)}`;
  let score = 0;
  for (const w of words) if (text.includes(` ${w}`)) score += 1;
  if (words.length && ` ${normText(product.name)}`.startsWith(` ${words[0]}`)) score += 0.5;
  return score;
}

/** Catalogue names of the chains this app shows (rows of other chains never become offers). */
const OUR_CATALOGUE_NAMES = [...new Set(CHAIN_IDS.flatMap((id) => {
  const name = CHAINS[id].catalogueName;
  const bare = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return bare === name ? [name] : [name, bare];
}))];

/**
 * Product cards from the catalogue for a search: products whose name or brand has every
 * significant word of the query (accents, ñ and case folded on both sides; a word of three
 * letters or more may be a prefix: "huevos" finds "huevo"; shorter ones start a word), or
 * whose EAN is the query, each with its prices from the chosen source.
 *
 * Which products come back is decided before the cut at SEARCH_PRODUCT_LIMIT, in SQL:
 * products with a price from the chosen source at one of our chains first, then the ones
 * whose words start with the query's, then the most recently seen, then by name. Products
 * without such prices only fill the places left.
 */
export async function catalogueSearch(db: D1Database, q: string, source: CatalogueSource = 'open_prices'): Promise<Product[]> {
  const term = q.trim();
  const p = new Params();
  const src = p.add(source);
  const names = p.list(OUR_CATALOGUE_NAMES);
  const eans = /^\d{8,14}$/.test(term) ? eanVariants(term) : [];
  const words = eans.length ? [] : searchWords(term);
  if (!eans.length && !words.length) return [];

  let hits: string;
  if (eans.length) {
    hits = `SELECT p.ean AS ean, p.name AS name, 0 AS starts FROM products p WHERE p.ean IN (${p.list(eans)})`;
  } else {
    const like = (pattern: string) => `t LIKE ${p.add(pattern)} ESCAPE '\\'`;
    const starts = words.map((w) => `(${like(`% ${escapeLike(w)}%`)})`).join(' + ');
    const all = words.map((w) => like(w.length >= 3 ? `%${escapeLike(w)}%` : `% ${escapeLike(w)}%`)).join(' AND ');
    hits = `SELECT ean, name, ${starts} AS starts FROM (
        SELECT p.ean AS ean, p.name AS name, ' ' || ${foldSql("p.name || ' ' || coalesce(p.brand, '')")} AS t FROM products p
      ) WHERE ${all}`;
  }
  const sql = `WITH hits AS (${hits}),
    ranked AS (
      SELECT h.ean AS ean FROM hits h
      LEFT JOIN prices x ON x.ean = h.ean AND x.source = ${src} AND x.chain IN (${names})
      GROUP BY h.ean
      ORDER BY COUNT(x.ean) > 0 DESC, h.starts DESC, MAX(x.observed_on) DESC, h.name, h.ean
      LIMIT ${SEARCH_PRODUCT_LIMIT}
    )
    ${SELECT_ROWS} FROM products p LEFT JOIN prices x ON x.ean = p.ean AND x.source = ${src}
    WHERE p.ean IN (SELECT ean FROM ranked)
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
  // Products with prices first, then the best match, then by name, then the cheapest.
  const cheapest = (p: Product) => p.offers[0]?.priceCents ?? Number.POSITIVE_INFINITY;
  const score = new Map(products.map((pr) => [pr, relevance(pr, words)]));
  products.sort((a, b) => Number(b.offers.length > 0) - Number(a.offers.length > 0)
    || score.get(b)! - score.get(a)!
    || a.name.localeCompare(b.name, 'es') || cheapest(a) - cheapest(b));
  return products;
}
