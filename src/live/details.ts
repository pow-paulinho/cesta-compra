/**
 * GET /api/details?ean= : a product's details (Nutri-Score, NOVA, ingredients, allergens,
 * photos) from Open Food Facts, when its provider is wired; { details: null } otherwise.
 * Answers are cached by the browser for 24 h (and the upstream request by http.ts).
 *
 * GET /api/live : whether this request may search live, and how each chain is searched.
 */
import { CHAINS } from '../shared/chains';
import { CHAIN_IDS, type ChainInfo, type LiveStatus } from '../shared/types';
import { liveAccess, type LiveAccess, type LiveKeyEnv } from './auth';
import { adapterCtx, failure, fallbackReason, json, liveAdapter, retryOnceIfUnavailable, withDeadline, type LiveDeps } from './common';

export const DETAILS_MAX_AGE_S = 24 * 3600;

export async function handleDetails(request: Request, deps: LiveDeps): Promise<Response> {
  const ean = (new URL(request.url).searchParams.get('ean') ?? '').trim();
  if (!/^\d{8,14}$/.test(ean)) return json({ error: 'ean: un código de barras de 8 a 14 cifras, por ejemplo /api/details?ean=8410128796228' }, 400);
  const off = deps.off;
  if (!off.details) return json({ details: null });
  try {
    const controller = new AbortController();
    const { ctx, meta } = adapterCtx('openfoodfacts', deps, controller.signal);
    const once = retryOnceIfUnavailable(() => off.details!.call(off, ean, ctx), { signal: controller.signal, sleep: deps.sleep, meta });
    const details = await withDeadline(once, deps.deadlineMs, 'openfoodfacts', controller);
    return json({ details: details ?? null }, 200, details ? { 'cache-control': `public, max-age=${DETAILS_MAX_AGE_S}` } : {});
  } catch (err) {
    return json({ details: null, error: failure(err, 'Open Food Facts').reason }, 502);
  }
}

/** LiveStatus, plus `access` (why live is on or off; never the key itself). */
export function liveStatus(env: LiveKeyEnv, request: Request, deps: Pick<LiveDeps, 'adapters'>): LiveStatus & { access: LiveAccess } {
  const access = liveAccess(env, request);
  const chains: ChainInfo[] = CHAIN_IDS.map((id) =>
    liveAdapter(id, deps.adapters)
      ? { id, name: CHAINS[id].name, mode: 'live' as const }
      : { id, name: CHAINS[id].name, mode: 'fallback' as const, reason: fallbackReason(id) },
  );
  return { live: access === 'ok', access, chains };
}
