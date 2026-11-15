/**
 * The owner's key for live supermarket search.
 *
 * LIVE_KEY is a Worker secret (wrangler secret put LIVE_KEY, or .dev.vars locally). A request
 * unlocks live search when it carries the same value in the `x-live-key` header. Without the
 * secret, live search is off for everyone. Open Food Facts and the D1 catalogue never need it.
 *
 * The key is never logged and never echoed back.
 */
export const LIVE_KEY_HEADER = 'x-live-key';

export interface LiveKeyEnv {
  LIVE_KEY?: string;
}

/** Why a request is or is not allowed to search live (no secret values in it). */
export type LiveAccess = 'ok' | 'disabled' | 'missing' | 'wrong';

const encoder = new TextEncoder();

/**
 * Compares two strings over their UTF-8 bytes in time that depends only on their lengths,
 * not on where they differ.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const x = encoder.encode(a);
  const y = encoder.encode(b);
  const n = Math.max(x.length, y.length);
  let diff = x.length ^ y.length;
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function serverKey(env: LiveKeyEnv | null | undefined): string | null {
  const key = typeof env?.LIVE_KEY === 'string' ? env.LIVE_KEY.trim() : '';
  return key ? key : null;
}

export function liveAccess(env: LiveKeyEnv | null | undefined, request: Request): LiveAccess {
  const key = serverKey(env);
  if (!key) return 'disabled';
  const given = request.headers.get(LIVE_KEY_HEADER);
  if (given === null || given === '') return 'missing';
  return constantTimeEqual(given, key) ? 'ok' : 'wrong';
}

/** True when the server has a key and the request carries the same one. */
export function liveAllowed(env: LiveKeyEnv | null | undefined, request: Request): boolean {
  return liveAccess(env, request) === 'ok';
}

/** What a locked chain tells the user, in Spanish. */
export function lockedReason(access: LiveAccess, chainName: string): string {
  if (access === 'disabled') return `La búsqueda en directo no está activada en este servidor, así que no consultamos ${chainName}.`;
  if (access === 'wrong') return `Tu clave no coincide con la del servidor: revísala en Ajustes para buscar en ${chainName} en directo.`;
  return `Para buscar en ${chainName} en directo, pon tu clave en Ajustes.`;
}
