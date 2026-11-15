/**
 * POST /api/hunt : look for one product in every chain, streamed as NDJSON, one HuntEvent per
 * chain for all 8 chains as each one answers, then { type: 'done' }.
 *
 *   - a chain searched live (adapter + mode 'live') with the owner's key: the adapter is asked
 *     once (exact mode: brand and name without the size; equivalent mode: the generic words
 *     of the name, without the brand), and its offers are ranked and the best one picked;
 *   - the same chain without the key: 'locked', with the reason; it is never called, and the
 *     catalogue's prices for it (if any) ride along as candidates;
 *   - every other chain: candidates from the D1 catalogue (Open Prices; the demo set when the
 *     request says demo: true), with the chain's reason;
 *   - a chain left out of `chains`: 'unavailable'.
 * A chain that fails answers 'error' or 'blocked'; the stream always reaches 'done'.
 */
import { CHAINS } from '../shared/chains';
import { OWN_BRANDS, normText, pickBest, rankCandidates, tokens } from '../shared/equiv';
import { CHAIN_IDS, type Candidate, type ChainId, type HuntEvent, type HuntMode, type Offer, type WantedProduct } from '../shared/types';
import { liveAccess, lockedReason, type LiveKeyEnv } from './auth';
import { failure, fallbackReason, json, liveAdapter, runAdapter, type LiveDeps } from './common';
import { fallbackOffers } from './fallback';
import { ndjsonStream } from './ndjson';

export interface HuntEnv extends LiveKeyEnv {
  DB?: D1Database;
}

export interface HuntInput {
  product: WantedProduct;
  mode: HuntMode;
  /** null: every chain. */
  chains: ChainId[] | null;
  demo: boolean;
  qty: number;
}

export const HUNT_ACCEPTS =
  'Se espera JSON: { "product": { "name": 2 a 120 caracteres, "brand": texto o null, "sizeText": texto o null, '
  + '"ean": 8 a 14 cifras o null }, "mode": "exact" o "equivalent", "chains": lista opcional de '
  + `${CHAIN_IDS.join(', ')}, "demo": opcional true o false, "qty": opcional, 1 a 99 }`;

/** Largest body /api/hunt reads. */
export const HUNT_MAX_BYTES = 8 * 1024;

const optText = (v: unknown, max: number): string | null | undefined => {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string') return undefined;
  const s = v.replace(/\s+/g, ' ').trim();
  if (s.length > max) return undefined;
  return s || null;
};

/** The hunt a body asks for, or the reason it is refused. */
export function parseHunt(body: unknown): { ok: true; value: HuntInput } | { ok: false; error: string } {
  const bad = (what: string) => ({ ok: false as const, error: `${what}. ${HUNT_ACCEPTS}` });
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('El cuerpo no es un objeto JSON');
  const b = body as Record<string, unknown>;
  const p = b.product as Record<string, unknown> | null | undefined;
  if (!p || typeof p !== 'object' || Array.isArray(p)) return bad('Falta product');
  const name = typeof p.name === 'string' ? p.name.replace(/\s+/g, ' ').trim() : '';
  if (name.length < 2 || name.length > 120) return bad('product.name debe tener entre 2 y 120 caracteres');
  const brand = optText(p.brand, 80);
  if (brand === undefined) return bad('product.brand debe ser texto (hasta 80 caracteres) o null');
  const sizeText = optText(p.sizeText, 40);
  if (sizeText === undefined) return bad('product.sizeText debe ser texto (hasta 40 caracteres) o null');
  let ean: string | null = null;
  if (p.ean !== undefined && p.ean !== null && p.ean !== '') {
    const e = typeof p.ean === 'string' ? p.ean.trim() : typeof p.ean === 'number' ? String(p.ean) : '';
    if (!/^\d{8,14}$/.test(e)) return bad('product.ean debe tener de 8 a 14 cifras o ser null');
    ean = e;
  }
  if (b.mode !== 'exact' && b.mode !== 'equivalent') return bad('mode debe ser "exact" o "equivalent"');
  let chains: ChainId[] | null = null;
  if (b.chains !== undefined && b.chains !== null) {
    if (!Array.isArray(b.chains) || b.chains.length === 0) return bad('chains debe ser una lista con al menos un super');
    const known = new Set<string>(CHAIN_IDS);
    const unknown = b.chains.filter((c) => typeof c !== 'string' || !known.has(c));
    if (unknown.length) return bad(`chains tiene supers que no conocemos (${unknown.map(String).join(', ')})`);
    chains = [...new Set(b.chains as ChainId[])];
  }
  if (b.demo !== undefined && typeof b.demo !== 'boolean') return bad('demo debe ser true o false');
  let qty = 1;
  if (b.qty !== undefined) {
    if (typeof b.qty !== 'number' || !Number.isInteger(b.qty) || b.qty < 1 || b.qty > 99) return bad('qty debe ser un entero de 1 a 99');
    qty = b.qty;
  }
  return { ok: true, value: { product: { name, brand, sizeText, ean }, mode: b.mode, chains, demo: b.demo === true, qty } };
}

/** Sizes and pack counts inside a name: "6 x 1 L", "pack 6 x 200 ml", "1,5 kg", "500g", "12 ud". */
const SIZE_IN_NAME =
  /(?:\bpack\s+(?:de\s+)?)?(?:\b\d+\s*[x×]\s*)?\b\d+(?:[.,]\d+)?\s*(?:kgs?|g|grs?|gramos|l|lt|litros?|ml|cl|uds?|unidades|u)\b\.?/gi;

/** The name without sizes and with tidy spaces. */
export function stripSize(name: string): string {
  return name.replace(SIZE_IN_NAME, ' ').replace(/\s+[-,/]\s*$/, '').replace(/\s+/g, ' ').trim();
}

/** Single-word own brands ("Hacendado", "Milbona"): another chain's label is no help in a search. */
const OWN_BRAND_WORDS = new Set(
  Object.values(OWN_BRANDS).flat().map(normText).filter((w) => w && !w.includes(' ')),
);

/**
 * What a chain is asked for.
 * exact: the brand (unless the name already has it) and the name, without the size.
 * equivalent: the name without the size, without the brand's words and without single-word
 * own brands, accents kept; words like "sin" stay ("leche sin lactosa"), dangling ones go.
 */
export function huntQuery(product: WantedProduct, mode: HuntMode): string {
  const name = stripSize(product.name) || product.name.trim();
  if (mode === 'exact') {
    const brand = (product.brand ?? '').split(/[,;|]/)[0]!.trim();
    const hasBrand = !brand || ` ${normText(name)} `.includes(` ${normText(brand)} `);
    return (hasBrand ? name : `${brand} ${name}`).slice(0, 80).trim();
  }
  const brandWords = new Set(tokens(product.brand ?? ''));
  const words = name.split(/\s+/).filter((w) => {
    const t = tokens(w);
    if (!t.length) return normText(w) !== '';
    return !t.every((x) => brandWords.has(x) || OWN_BRAND_WORDS.has(x));
  });
  // No stop word left hanging at either end ("Zumo de" from "Zumo de Don Simon").
  while (words.length && !tokens(words[0]!).length) words.shift();
  while (words.length && !tokens(words[words.length - 1]!).length) words.pop();
  const q = words.join(' ').trim();
  return (q || name).slice(0, 80).trim();
}

/** Ranked candidates and the pick for one chain's offers. */
export function choose(product: WantedProduct, offers: Offer[], mode: HuntMode, qty: number): { candidates: Candidate[]; pick: Candidate | null } {
  const candidates = rankCandidates(product, offers, mode);
  return { candidates, pick: pickBest(candidates, mode, product, qty) };
}

const noneReason = (mode: HuntMode, name: string): string =>
  mode === 'exact' ? `No hemos encontrado este producto en ${name}.` : `No hemos encontrado nada equivalente en ${name}.`;

export async function runHunt(input: HuntInput, request: Request, env: HuntEnv, deps: LiveDeps, emit: (e: HuntEvent) => Promise<void>): Promise<void> {
  const started = Date.now();
  const ms = () => Date.now() - started;
  const access = liveAccess(env, request);
  const { product, mode, qty } = input;
  const query = huntQuery(product, mode);

  const live: ChainId[] = [];
  const locked: ChainId[] = [];
  const fallback: ChainId[] = [];
  const skipped: ChainId[] = [];
  for (const id of CHAIN_IDS) {
    if (input.chains && !input.chains.includes(id)) skipped.push(id);
    else if (!liveAdapter(id, deps.adapters)) fallback.push(id);
    else if (access === 'ok') live.push(id);
    else locked.push(id);
  }

  // One catalogue read serves every chain that answers from it.
  const fromCatalogue = [...fallback, ...locked];
  const catalogue: Promise<Partial<Record<ChainId, Offer[]>>> = !fromCatalogue.length
    ? Promise.resolve({})
    : env.DB
      ? fallbackOffers(env.DB, product, fromCatalogue, { source: input.demo ? 'demo' : 'open_prices', mode })
      : Promise.reject(new Error('no D1 binding'));
  catalogue.catch(() => undefined);

  const demoNote = input.demo ? ' Modo demo: precios de ejemplo, no reales.' : '';
  const tasks: Array<Promise<void>> = [];
  const answer = (chain: ChainId, work: () => Promise<Omit<Extract<HuntEvent, { type: 'chain' }>, 'type' | 'chain' | 'ms'>>) => {
    tasks.push((async () => {
      let event: HuntEvent;
      try {
        event = { type: 'chain', chain, ...(await work()), ms: ms() };
      } catch (err) {
        event = { type: 'chain', chain, candidates: [], pick: null, ...failure(err, CHAINS[chain].name), ms: ms() };
      }
      await emit(event);
    })());
  };

  for (const id of skipped) {
    answer(id, async () => ({ status: 'unavailable', candidates: [], pick: null, reason: 'No está entre los supers elegidos para esta búsqueda.' }));
  }

  for (const id of live) {
    const adapter = liveAdapter(id, deps.adapters)!;
    answer(id, async () => {
      const { candidates, pick } = choose(product, await runAdapter(adapter, query, deps), mode, qty);
      return pick
        ? { status: 'ok', candidates, pick }
        : { status: 'none', candidates, pick: null, reason: noneReason(mode, CHAINS[id].name) };
    });
  }

  for (const id of locked) {
    answer(id, async () => {
      const reason = lockedReason(access, CHAINS[id].name);
      let offers: Offer[] = [];
      try {
        offers = (await catalogue)[id] ?? [];
      } catch {
        // The lock is the answer; a missing catalogue only means no prices ride along.
      }
      const { candidates, pick } = choose(product, offers, mode, qty);
      return candidates.length
        ? { status: 'locked', candidates, pick, reason: `${reason} Mientras, te enseñamos lo que tiene el catálogo de precios.${demoNote}` }
        : { status: 'locked', candidates: [], pick: null, reason };
    });
  }

  for (const id of fallback) {
    answer(id, async () => {
      let offers: Offer[];
      try {
        offers = (await catalogue)[id] ?? [];
      } catch {
        return { status: 'unavailable', candidates: [], pick: null, reason: 'El catálogo de precios no está disponible ahora mismo.' };
      }
      const { candidates, pick } = choose(product, offers, mode, qty);
      const reason = `${fallbackReason(id)}${demoNote}`;
      return pick ? { status: 'ok', candidates, pick, reason } : { status: 'none', candidates, pick: null, reason };
    });
  }

  await Promise.all(tasks);
  await emit({ type: 'done', ms: ms() });
}

/** Reads the body (at most HUNT_MAX_BYTES), validates it, and streams the hunt. */
export async function handleHunt(request: Request, env: HuntEnv, deps: LiveDeps, waitUntil?: (p: Promise<unknown>) => void): Promise<Response> {
  const text = await request.text().catch(() => null);
  if (text === null) return json({ error: `No hemos podido leer el cuerpo. ${HUNT_ACCEPTS}` }, 400);
  if (new TextEncoder().encode(text).length > HUNT_MAX_BYTES) return json({ error: `El cuerpo pasa de ${HUNT_MAX_BYTES} bytes. ${HUNT_ACCEPTS}` }, 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: `El cuerpo no es JSON. ${HUNT_ACCEPTS}` }, 400);
  }
  const parsed = parseHunt(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const stream = ndjsonStream(
    (emit) => runHunt(parsed.value, request, env, deps, emit),
    (err) => console.error('hunt stream failed:', err instanceof Error ? err.message : String(err)),
  );
  waitUntil?.(stream.done);
  return stream.response;
}
