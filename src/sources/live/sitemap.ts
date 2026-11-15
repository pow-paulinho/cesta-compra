/**
 * Sitemap-driven search for chains whose sites have no robots-allowed search page.
 *
 * Aldi and Ahorramas publish every product URL in a sitemap their robots.txt points at
 * (`Sitemap:` lines). Their search pages are either missing (Aldi) or disallowed
 * (Ahorramas: `Disallow: /buscador?*`), so a "search" here is: read the product
 * sitemap once a day (kind 'index', cached 24 h by http.ts and kept in memory here),
 * match the query against the readable slugs, and fetch only the few best product pages.
 *
 * Also holds the small page helpers both adapters share: fetching a page with the
 * blocked/challenge checks, HTML entity decoding, robots.txt Disallow matching.
 */
import type { PriceUnit } from '../../shared/types';
import { sizeFromName, type Size } from '../../shared/units';
import { BlockedError, type AdapterCtx, type FetchKind } from './types';

export interface SitemapEntry {
  /** The readable part of the URL, percent-decoded ("leche-entera-alipende-1l"). */
  slug: string;
  /** The chain's product id at the end of the URL. */
  id: string;
  /** The URL exactly as the sitemap lists it. */
  url: string;
}

export const SITEMAP_MAX_AGE_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s
    .replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
      }
      return XML_ENTITIES[e.toLowerCase()] ?? m;
    });
}

/** decodeURIComponent that never throws: a malformed escape leaves the text as it was. */
export function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * The `<loc>` URLs of a sitemap that match `pattern`, as {slug, id, url}. The pattern is
 * matched against the URL as listed and must capture the slug and the id, either as named
 * groups `slug`/`id` or as groups 1 and 2. Other URLs are ignored; duplicates are dropped.
 */
export function parseSitemap(xml: string, pattern: RegExp): SitemapEntry[] {
  const out: SitemapEntry[] = [];
  const seen = new Set<string>();
  const re = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
  for (const m of xml.matchAll(/<loc>\s*([\s\S]*?)\s*<\/loc>/g)) {
    const url = decodeXml(m[1]!.trim());
    const hit = re.exec(url);
    if (!hit) continue;
    const slug = safeDecode(hit.groups?.slug ?? hit[1] ?? '').trim();
    const id = (hit.groups?.id ?? hit[2] ?? '').trim();
    if (!slug || !id || seen.has(url)) continue;
    seen.add(url);
    out.push({ slug, id, url });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fetching (with an in-isolate cache on top of http.ts's Cache API)
// ---------------------------------------------------------------------------

interface CacheSlot {
  at: number;
  entries: Promise<SitemapEntry[]>;
}
const memory = new Map<string, CacheSlot>();

/** Forgets every sitemap kept in memory (tests, or after a deploy-time change of pattern). */
export function clearSitemapCache(): void {
  memory.clear();
}

/**
 * The product entries of a sitemap, fetched at most once per 24 h per isolate (kind
 * 'index', so http.ts also caches the response for 24 h). Concurrent callers share one
 * request. A refusal throws BlockedError; any other failure throws Error and is not cached.
 */
export function fetchSitemapIndex(ctx: AdapterCtx, url: string, pattern: RegExp): Promise<SitemapEntry[]> {
  const now = ctx.now.getTime();
  const key = `${url} ${pattern.source}`;
  const slot = memory.get(key);
  if (slot && now - slot.at >= 0 && now - slot.at < SITEMAP_MAX_AGE_MS) return slot.entries;

  const entries = (async () => {
    const xml = await fetchPage(ctx, url, 'index', 'application/xml,text/xml;q=0.9,*/*;q=0.5');
    if (xml === null) throw new Error(`sitemap not found (404): ${url}`);
    const list = parseSitemap(xml, pattern);
    if (list.length === 0) throw new Error(`sitemap without product URLs: ${url}`);
    return list;
  })();
  memory.set(key, { at: now, entries });
  entries.catch(() => {
    if (memory.get(key)?.entries === entries) memory.delete(key);
  });
  return entries;
}

/** Markers of anti-bot interstitials (Cloudflare, Akamai, Imperva, DataDome, PerimeterX). */
const CHALLENGE_RE = new RegExp(
  [
    'cf_chl_opt', 'cf-chl-', '<title>\\s*Just a moment', 'Attention Required! \\| Cloudflare',
    '_Incapsula_Resource', 'Pardon Our Interruption', 'captcha-delivery\\.com', 'px-captcha',
    'errors\\.edgesuite\\.net', '<title>\\s*Access Denied', 'Request unsuccessful\\. Incapsula',
  ].join('|'),
  'i',
);

/** True for an anti-bot challenge page instead of the content asked for. */
export function isChallengePage(text: string): boolean {
  return CHALLENGE_RE.test(text.slice(0, 30_000));
}

/** The header http.ts puts on responses it served from its cache ("hit"). */
const CACHE_FLAG_HEADER = 'x-cesta-cache';

/**
 * GETs a page through the polite fetch and returns its text, or null for 404/410 (a
 * product that left the catalogue since the sitemap was written).
 * 403/429, a `cf-mitigated: challenge` header or a challenge page throw BlockedError;
 * any other HTTP error throws Error.
 */
export async function fetchPage(ctx: AdapterCtx, url: string, kind: FetchKind, accept = 'text/html'): Promise<string | null> {
  return (await fetchPageWithMeta(ctx, url, kind, accept))?.text ?? null;
}

/** fetchPage, also telling whether http.ts answered from its cache. */
export async function fetchPageWithMeta(
  ctx: AdapterCtx,
  url: string,
  kind: FetchKind,
  accept = 'text/html',
): Promise<{ text: string; cached: boolean } | null> {
  const res = await ctx.fetch(url, { kind, headers: { accept } });
  if (res.status === 403 || res.status === 429) {
    throw new BlockedError(res.status, `blocked (${res.status}) at ${new URL(url).host}`);
  }
  if (res.headers.get('cf-mitigated') === 'challenge') {
    throw new BlockedError(res.status, `challenge page at ${new URL(url).host}`);
  }
  if (res.status === 404 || res.status === 410) return null;
  const text = await res.text();
  if (isChallengePage(text)) throw new BlockedError(res.status, `challenge page at ${new URL(url).host}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return { text, cached: res.headers.get(CACHE_FLAG_HEADER) === 'hit' };
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

/**
 * A guard for robots.txt `Disallow:` patterns (`*` wildcard, `$` end anchor, otherwise a
 * prefix of path + query). Returns true when the URL may be fetched.
 */
export function robotsGuard(disallow: readonly string[]): (url: string) => boolean {
  const rules = disallow.map((rule) => {
    const anchored = rule.endsWith('$');
    const body = (anchored ? rule.slice(0, -1) : rule)
      .split('*')
      .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*');
    return new RegExp(`^${body}${anchored ? '$' : ''}`);
  });
  return (url: string) => {
    let target: string;
    try {
      const u = new URL(url);
      target = `${u.pathname}${u.search}`;
    } catch {
      return false;
    }
    return !rules.some((r) => r.test(target));
  };
}

// ---------------------------------------------------------------------------
// Matching a query against slugs
// ---------------------------------------------------------------------------

/** Spanish words that carry no product meaning. ("sin" is kept: "sin lactosa".) */
const STOP_WORDS = new Set([
  'a', 'al', 'con', 'de', 'del', 'e', 'el', 'en', 'la', 'las', 'lo', 'los', 'o', 'para', 'por',
  'su', 'sus', 'u', 'un', 'una', 'unas', 'unos', 'y',
]);
/** Pack, container and measure words: they describe the size, never the product. */
const SIZE_WORDS = new Set([
  'pack', 'formato', 'x', 'ud', 'uds', 'und', 'unds', 'unid', 'unidad', 'unidades',
  'g', 'gr', 'grs', 'gramo', 'gramos', 'kg', 'kgs', 'kilo', 'kilos', 'l', 'lt', 'lts', 'litro', 'litros',
  'ml', 'cl', 'mililitros', 'centilitros',
  'bote', 'botes', 'botella', 'botellas', 'botellin', 'brik', 'briks', 'brick', 'bricks', 'lata', 'latas',
  'garrafa', 'bolsa', 'bandeja', 'tarro', 'paquete', 'caja', 'envase', 'tarrina',
]);

/**
 * Folds singular and plural to one form, applied to both sides: a final s goes, a final z
 * becomes c and a final e goes, so leche/leches -> lech, huevo/huevos -> huevo,
 * yogur/yogures -> yogur, nuez/nueces -> nuec, carne/carnes -> carn.
 */
export function foldWord(t: string): string {
  if (t.length <= 3 || /\d/.test(t)) return t;
  let w = t;
  if (w.endsWith('s')) w = w.slice(0, -1);
  if (w.endsWith('z')) w = `${w.slice(0, -1)}c`;
  if (w.endsWith('e') && w.length > 4) w = w.slice(0, -1);
  return w;
}

/** Lowercase, no accents, NBSP and punctuation as spaces; decimal points between digits stay. */
function normalise(s: string): string {
  return s
    .replace(/%c2%a0/gi, ' ')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u00a0\u2009\u202f]/g, ' ')
    .replace(/(\d)[.,](\d)/g, '$1\u0000$2')
    .replace(/[^a-z0-9\u0000]+/g, ' ')
    .replace(/\u0000/g, '.')
    .trim();
}

interface Word {
  raw: string;
  fold: string;
}

interface Tokens {
  /** Content words in order (no stop, size or number words), as written and folded. */
  words: Word[];
  size: Size | null;
  length: number;
}

function tokenise(text: string): Tokens {
  const norm = normalise(text);
  const words: Word[] = [];
  for (const raw of norm.split(' ')) {
    if (!raw || raw.length < 2 || STOP_WORDS.has(raw) || SIZE_WORDS.has(raw) || /^\d/.test(raw)) continue;
    words.push({ raw, fold: foldWord(raw) });
  }
  return { words, size: sizeFromName(norm), length: norm.length };
}

const slugCache = new WeakMap<SitemapEntry, Tokens>();
function slugTokens(e: SitemapEntry): Tokens {
  let t = slugCache.get(e);
  if (!t) {
    t = tokenise(e.slug);
    slugCache.set(e, t);
  }
  return t;
}

/**
 * 1 for the same word once folded; 0.85 when one word, as written, is a prefix of the other
 * of at least 4 letters ("semidesnata" in a slug, "semi" in a query); 0 otherwise.
 */
function wordMatch(q: Word, s: Word): number {
  if (q.fold === s.fold) return 1;
  const short = q.raw.length < s.raw.length ? q.raw : s.raw;
  const long = short === q.raw ? s.raw : q.raw;
  return short.length >= 4 && long.startsWith(short) ? 0.85 : 0;
}

function sizeBoost(q: Size | null, s: Size | null): number {
  if (!q || !s || q.unit !== s.unit) return 0;
  if (q.count === s.count && Math.abs(q.amount - s.amount) <= q.amount * 0.005) return 0.3;
  const qt = q.count * q.amount;
  return Math.abs(qt - s.count * s.amount) <= qt * 0.005 ? 0.15 : 0;
}

/** Results scoring below this share of the best one are left out (fewer pointless fetches). */
const RELATIVE_CUTOFF = 0.6;
const HEAD_BONUS = 0.5;
/** Words written exactly as typed ("huevos" for "huevos") edge out folded ones ("huevo de chocolate"). */
const VERBATIM_BONUS = 0.1;

/**
 * The entries whose slugs best answer `query`, best first, at most `limit`.
 *
 * Every content word of the query must meet a slug word (same word after accent and
 * plural folding, or a prefix of ≥ 4 letters). Survivors are ranked by coverage (the share
 * of the slug's words the query explains, one slug word per query word), with a bonus when
 * the slug starts with a query word (the product noun: "huevos camperos" before
 * "spaghettini al huevo"), a smaller one for words written exactly as typed, and one when
 * the size in the query (1l, 500g, 6x200ml) is the slug's size; ties go to the shorter
 * slug, then to the slug and id themselves, so the order never depends on the sitemap's.
 * Entries scoring under 60 % of the best one are dropped.
 */
export function matchSlugs(entries: readonly SitemapEntry[], query: string, limit: number): SitemapEntry[] {
  const q = tokenise(query);
  const wanted = q.words.filter((w, i) => q.words.findIndex((o) => o.fold === w.fold) === i);
  if (wanted.length === 0 || limit <= 0) return [];

  const scored: Array<{ e: SitemapEntry; score: number; len: number }> = [];
  for (const e of entries) {
    const s = slugTokens(e);
    if (s.words.length === 0) continue;
    // Each query word must meet a slug word; it explains one slug word (its best match).
    let quality = 0;
    let verbatim = 0;
    let ok = true;
    for (const w of wanted) {
      let best = 0;
      for (const sw of s.words) best = Math.max(best, wordMatch(w, sw));
      if (best === 0) {
        ok = false;
        break;
      }
      quality += best;
      if (s.words.some((sw) => sw.raw === w.raw)) verbatim += 1;
    }
    if (!ok) continue;
    const coverage = Math.min(1, quality / s.words.length);
    const head = wanted.some((w) => wordMatch(w, s.words[0]!) > 0) ? HEAD_BONUS : 0;
    const asTyped = VERBATIM_BONUS * (verbatim / wanted.length);
    scored.push({ e, score: coverage + head + asTyped + sizeBoost(q.size, s.size), len: s.length });
  }
  if (scored.length === 0) return [];

  scored.sort(
    (a, b) =>
      b.score - a.score ||
      a.len - b.len ||
      (a.e.slug < b.e.slug ? -1 : a.e.slug > b.e.slug ? 1 : 0) ||
      (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0),
  );
  const floor = scored[0]!.score * RELATIVE_CUTOFF;
  return scored.filter((x) => x.score >= floor).slice(0, limit).map((x) => x.e);
}

// ---------------------------------------------------------------------------
// Small helpers shared by the sitemap-driven adapters
// ---------------------------------------------------------------------------

const HTML_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0', euro: '€', middot: '·',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', Aacute: 'Á', Eacute: 'É',
  Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', ntilde: 'ñ', Ntilde: 'Ñ', uuml: 'ü', Uuml: 'Ü',
  ccedil: 'ç', Ccedil: 'Ç', agrave: 'à', egrave: 'è', ograve: 'ò', ordf: 'ª', ordm: 'º',
  iexcl: '¡', iquest: '¿', reg: '®', trade: '™', copy: '©', deg: '°', ndash: '–', mdash: '—',
};

export function decodeHtml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : m;
    }
    return HTML_ENTITIES[e] ?? HTML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Text content of an HTML fragment: tags dropped, entities decoded, whitespace collapsed. */
export function htmlText(fragment: string): string {
  return decodeHtml(fragment.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/[\s\u00a0]+/g, ' ')
    .trim();
}

/** An absolute https URL for `src` relative to `base`; null when there is nothing usable. */
export function absoluteUrl(src: string | null | undefined, base: string): string | null {
  if (typeof src !== 'string') return null;
  const s = decodeHtml(src.trim());
  if (!s || s.startsWith('data:')) return null;
  try {
    const u = new URL(s, base);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** YYYY-MM-DD (UTC) of a date. */
export function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** "1.29", "1,29", "1.234,56" -> cents; null when it is not a positive amount. */
export function eurosToCents(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else if (typeof v === 'string') {
    let s = v.replace(/[€\s\u00a0]/g, '');
    if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
    if (!/^\d+(\.\d+)?$/.test(s)) return null;
    n = Number(s);
  } else return null;
  if (!Number.isFinite(n) || n <= 0 || n > 100_000) return null;
  return Math.round(n * 100);
}

const SMALL_WORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'y', 'e']);

/** A display brand: trademark signs dropped; ALL-CAPS brands in title case ("MILSANI®" -> "Milsani"). */
export function cleanBrand(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const b = raw.replace(/[®™©]/g, '').replace(/\s+/g, ' ').trim();
  if (!b) return null;
  if (b !== b.toUpperCase() || !/[A-ZÁÉÍÓÚÑ]/.test(b)) return b;
  return b
    .toLowerCase()
    .split(' ')
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

/** "25/11" from a day and month. */
export function dayMonth(day: number, month: number): string {
  return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}`;
}

/** The unit a published unit price is quoted in ("LITRO", "kg", "unidad"); null when unknown. */
export function priceUnitFromLabel(label: string): { unit: PriceUnit; per: number } | null {
  const l = normalise(label).replace(/\s+/g, '');
  if (/^(l|lt|lts|litro|litros)$/.test(l)) return { unit: 'l', per: 1 };
  if (/^(kg|kgs|kilo|kilos|kilogramo|kilogramos)$/.test(l)) return { unit: 'kg', per: 1 };
  if (/^(u|ud|uds|und|unidad|unidades|pieza|piezas)$/.test(l)) return { unit: 'ud', per: 1 };
  if (/^docenas?$/.test(l)) return { unit: 'ud', per: 12 };
  if (/^100(g|gr|gramos)$/.test(l)) return { unit: 'kg', per: 0.1 };
  if (/^100ml$/.test(l)) return { unit: 'l', per: 0.1 };
  return null;
}
