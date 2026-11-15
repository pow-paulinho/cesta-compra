/**
 * The contract every live price source implements.
 *
 * Politeness lives in the PoliteFetch each adapter receives (http.ts): an honest
 * user agent, per-host spacing, a timeout and a cache. Adapters only request
 * paths their site's robots.txt allows, and say which lines they rely on.
 */
import type { ChainId, Offer } from '../../shared/types';

export type FetchKind = 'search' | 'detail' | 'index';

export interface PoliteFetch {
  (url: string, init?: RequestInit & { kind?: FetchKind; cacheKey?: string }): Promise<Response>;
}

export interface AdapterCtx {
  fetch: PoliteFetch;
  now: Date;
}

export interface ChainAdapter {
  chain: ChainId;
  /** Offers that may match the query; ranking happens in the caller. */
  search(query: string, ctx: AdapterCtx): Promise<Offer[]>;
}

/**
 * A failure whose reason, written by us in Spanish, may be shown to the user as it is
 * (the message stays technical, for the logs).
 */
export class SourceError extends Error {
  constructor(message: string, public readonly userReason: string) {
    super(message);
    this.name = 'SourceError';
  }
}

/** Thrown when the site refuses us (403/429/challenge page): reported as "blocked", never retried. */
export class BlockedError extends Error {
  constructor(public readonly status: number, message = `blocked (${status})`) {
    super(message);
    this.name = 'BlockedError';
  }
}
