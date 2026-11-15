/**
 * GET /api/search?q= : product cards, streamed as NDJSON, one SearchEvent per source as
 * soon as that source has answered, then { type: 'done' }.
 *
 * Sources, all started at once:
 *   - every chain searched live (an adapter and mode 'live'): only with the owner's key,
 *     otherwise it answers 'locked' at once and is never called;
 *   - Open Food Facts, when its provider is wired (no key needed);
 *   - 'catalogo': the D1 catalogue (Open Prices; the demo set with ?demo=1).
 * A chain marked live without an adapter on this server, and Open Food Facts when it is not
 * wired, answer 'unavailable' with the reason, so the client never waits for them.
 * One source failing never stops the others.
 */
import { CHAINS } from '../shared/chains';
import { CHAIN_IDS, type SearchEvent } from '../shared/types';
import { liveAccess, lockedReason, type LiveKeyEnv } from './auth';
import { adapterCtx, dedupeProducts, failure, fallbackReason, groupProducts, json, liveAdapter, runAdapter, withDeadline, type LiveDeps } from './common';
import { catalogueSearch } from './fallback';
import { ndjsonStream } from './ndjson';

export const QUERY_MIN = 2;
export const QUERY_MAX = 80;

export interface SearchEnv extends LiveKeyEnv {
  DB?: D1Database;
}

/** The trimmed query (inner spaces collapsed), or null when it is not 2 to 80 characters. */
export function searchQuery(raw: string | null): string | null {
  const q = (raw ?? '').replace(/\s+/g, ' ').trim();
  return q.length >= QUERY_MIN && q.length <= QUERY_MAX ? q : null;
}

const truthy = (v: string | null): boolean => v === '1' || v === 'true' || v === 'si' || v === 'sí';

export function handleSearch(request: Request, env: SearchEnv, deps: LiveDeps, waitUntil?: (p: Promise<unknown>) => void): Response {
  const url = new URL(request.url);
  const q = searchQuery(url.searchParams.get('q'));
  if (!q) return json({ error: `q: escribe entre ${QUERY_MIN} y ${QUERY_MAX} caracteres, por ejemplo /api/search?q=leche` }, 400);
  const demo = truthy(url.searchParams.get('demo'));
  const access = liveAccess(env, request);
  const started = Date.now();
  const ms = () => Date.now() - started;

  const stream = ndjsonStream(async (emit) => {
    const tasks: Array<Promise<void>> = [];

    for (const id of CHAIN_IDS) {
      const adapter = liveAdapter(id, deps.adapters);
      if (!adapter) {
        // Marked live but not wired here: its prices come from the catalogue only.
        if (CHAINS[id].mode === 'live') {
          tasks.push(emit({ type: 'source', source: id, status: 'unavailable', products: [], reason: fallbackReason(id), ms: ms() } satisfies SearchEvent));
        }
        continue;
      }
      const name = CHAINS[id].name;
      if (access !== 'ok') {
        tasks.push(emit({ type: 'source', source: id, status: 'locked', products: [], reason: lockedReason(access, name), ms: ms() } satisfies SearchEvent));
        continue;
      }
      tasks.push((async () => {
        let event: SearchEvent;
        try {
          const products = groupProducts(await runAdapter(adapter, q, deps));
          event = { type: 'source', source: id, status: products.length ? 'ok' : 'none', products, ms: ms() };
        } catch (err) {
          event = { type: 'source', source: id, products: [], ...failure(err, name), ms: ms() };
        }
        await emit(event);
      })());
    }

    const off = deps.off;
    if (off.search) {
      const search = off.search.bind(off);
      tasks.push((async () => {
        let event: SearchEvent;
        try {
          const { ctx } = adapterCtx('openfoodfacts', deps);
          const products = dedupeProducts(await withDeadline(search(q, ctx), deps.deadlineMs, 'openfoodfacts'));
          event = { type: 'source', source: 'openfoodfacts', status: products.length ? 'ok' : 'none', products, ms: ms() };
        } catch (err) {
          event = { type: 'source', source: 'openfoodfacts', products: [], ...failure(err, 'Open Food Facts'), ms: ms() };
        }
        await emit(event);
      })());
    } else {
      tasks.push(emit({
        type: 'source', source: 'openfoodfacts', status: 'unavailable', products: [],
        reason: 'Open Food Facts no está conectado en este servidor: verás los productos del catálogo, sin sus fotos.', ms: ms(),
      } satisfies SearchEvent));
    }

    tasks.push((async () => {
      let event: SearchEvent;
      if (!env.DB) {
        event = { type: 'source', source: 'catalogo', status: 'unavailable', products: [], reason: 'El catálogo no está disponible en este servidor.', ms: ms() };
      } else {
        try {
          const products = await catalogueSearch(env.DB, q, demo ? 'demo' : 'open_prices');
          event = { type: 'source', source: 'catalogo', status: products.length ? 'ok' : 'none', products, ms: ms() };
        } catch (err) {
          event = { type: 'source', source: 'catalogo', products: [], ...failure(err, 'el catálogo'), ms: ms() };
        }
      }
      await emit(event);
    })());

    await Promise.all(tasks);
    await emit({ type: 'done', ms: ms() } satisfies SearchEvent);
  }, (err) => console.error('search stream failed:', err instanceof Error ? err.message : String(err)));
  waitUntil?.(stream.done);
  return stream.response;
}
