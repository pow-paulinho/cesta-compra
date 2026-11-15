/**
 * The owner's key for live supermarket search.
 *
 * LIVE_KEY is a Worker secret (wrangler secret put LIVE_KEY, or .dev.vars locally). A request
 * unlocks live search when it carries the same value in the `x-live-key` header. Without the
 * secret, live search is off for everyone. Open Food Facts and the D1 catalogue never need it.
 *
 * The key is never logged and never echoed back. Guessing it online is slowed down: a client
 * (cf-connecting-ip) that sends WRONG_KEY_LIMIT wrong keys within WRONG_KEY_WINDOW_MS gets 429
 * on the routes that read the key until the oldest of those attempts leaves the window.
 */
import type { LiveAccess } from '../shared/types';

/** Why a request is or is not allowed to search live (no secret values in it). */
export type { LiveAccess };

export const LIVE_KEY_HEADER = 'x-live-key';

export interface LiveKeyEnv {
  LIVE_KEY?: string;
}

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

/** Wrong keys one client may send within the window before it has to wait. */
export const WRONG_KEY_LIMIT = 10;
export const WRONG_KEY_WINDOW_MS = 15 * 60_000;
/** Clients remembered at most (the oldest are forgotten first), so the map stays small. */
const MAX_CLIENTS = 2000;

/** Who is asking, as far as the key throttle is concerned. */
export function clientId(request: Request): string {
  return request.headers.get('cf-connecting-ip')?.trim() || 'unknown';
}

/** Wrong-key attempts per client, per isolate (a personal app needs no more). */
export class KeyThrottle {
  private readonly wrong = new Map<string, number[]>();

  constructor(private readonly limit = WRONG_KEY_LIMIT, private readonly windowMs = WRONG_KEY_WINDOW_MS) {}

  private recent(client: string, now: number): number[] {
    const stamps = (this.wrong.get(client) ?? []).filter((t) => t <= now && now - t < this.windowMs);
    if (stamps.length) this.wrong.set(client, stamps);
    else this.wrong.delete(client);
    return stamps;
  }

  /** Milliseconds until `client` may send a key again; 0 when it may now. */
  waitMs(client: string, now: number): number {
    const stamps = this.recent(client, now);
    return stamps.length >= this.limit ? stamps[stamps.length - this.limit]! + this.windowMs - now : 0;
  }

  recordWrong(client: string, now: number): void {
    const stamps = this.recent(client, now);
    stamps.push(now);
    this.wrong.delete(client);
    this.wrong.set(client, stamps);
    while (this.wrong.size > MAX_CLIENTS) this.wrong.delete(this.wrong.keys().next().value!);
  }
}

