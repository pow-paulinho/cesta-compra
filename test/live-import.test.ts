import { describe, expect, it, vi } from 'vitest';
import { runImport, sturdyFetch, type Env } from '../src/index';
import { CHAINS } from '../src/sources/openprices';

/*
 * The daily Open Prices import against a D1 stand-in over Node's built-in SQLite, with the
 * schema from migrations/0001_prices.sql (read only).
 */
interface SqliteDb { exec(sql: string): void; prepare(sql: string): { all(...v: unknown[]): unknown[]; run(...v: unknown[]): unknown } }
type Builtin = { getBuiltinModule?(id: string): unknown };
const proc = (globalThis as unknown as { process?: Builtin }).process;
const sqlite = proc?.getBuiltinModule?.('node:sqlite') as { DatabaseSync: new (p: string) => SqliteDb } | undefined;
const fs = proc?.getBuiltinModule?.('node:fs') as { readFileSync(p: URL, enc: 'utf8'): string } | undefined;
const here = (import.meta as unknown as { url: string }).url;

function d1(opts: { failPrices?: boolean } = {}): { db: D1Database; raw: SqliteDb } {
  const raw = new sqlite!.DatabaseSync(':memory:');
  raw.exec(fs!.readFileSync(new URL('../migrations/0001_prices.sql', here), 'utf8'));
  const statement = (q: string, v: unknown[] = []) => ({
    sql: q,
    bind: (...b: unknown[]) => statement(q, b),
    all: async () => ({ results: raw.prepare(q).all(...v).map((r) => ({ ...(r as object) })) }),
    first: async () => ({ ...(raw.prepare(q).all(...v)[0] as object) }),
    run: async () => {
      raw.prepare(q).run(...v);
      return { success: true };
    },
  });
  const db = {
    prepare: (q: string) => statement(q),
    batch: async (stmts: Array<{ sql: string; run(): Promise<unknown> }>) => {
      if (opts.failPrices && stmts.some((s) => s.sql.includes("'open_prices'"))) throw new Error('D1_ERROR: database is locked');
      for (const s of stmts) await s.run();
      return [];
    },
  } as unknown as D1Database;
  return { db, raw };
}

/** Open Prices as a fake: one Spanish location per chain, one price per location. */
function openPrices(trouble: Record<number, () => Response | Promise<Response>> = {}) {
  let n = 0;
  const doFetch = (async (url: string) => {
    n += 1;
    if (trouble[n]) return trouble[n]!();
    const u = new URL(url);
    if (u.pathname.endsWith('/locations')) {
      const like = u.searchParams.get('osm_name__like')!;
      const name = like === 'Corte Ingl' ? 'El Corte Inglés' : like;
      return Response.json({ page: 1, pages: 1, items: [{ id: name.length, osm_name: name, osm_address_country: 'España', osm_address_city: 'Madrid', price_count: 3 }] });
    }
    const id = Number(u.searchParams.get('location_id'));
    return Response.json({ items: [{ product_code: String(8410000000000 + id), price: 1.5, currency: 'EUR', date: '2026-11-10', product: { product_name: `Producto ${id}` } }] });
  }) as unknown as typeof fetch;
  return { doFetch, count: () => n };
}

const PLAN = { maxRequests: 90, locationsPerChain: 1, delayMs: 0, maxLocationPages: 1 };
const noWait = async () => undefined;

describe.skipIf(!sqlite || !fs)('the daily Open Prices import', () => {
  it('one lost connection or one page that is not JSON costs that page, not the run', async () => {
    const { db, raw } = d1();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const op = openPrices({
        7: () => { throw new Error('Network connection lost.'); },
        9: () => new Response('<html>Bad gateway</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
      });
      const r = await runImport({ DB: db } as Env, new Date('2026-11-15T03:00:00Z'), op.doFetch, { plan: PLAN, wait: noWait });
      expect(r.failed).toBe(2);
      // Request 7 was a location page: that chain has no price page to ask for.
      expect(r.requests).toBe(CHAINS.length * 2 - 1);
      // Every chain whose two pages answered has its price saved: all but the two hit.
      const saved = raw.prepare("SELECT COUNT(*) AS n FROM prices WHERE source = 'open_prices'").all()[0] as { n: number };
      expect(saved.n).toBe(CHAINS.length - 2);
      expect(raw.prepare('SELECT requests, prices FROM imports').all()).toEqual([{ requests: CHAINS.length * 2 - 1, prices: CHAINS.length - 2 }]);
      expect(String(warn.mock.calls[0]?.[0])).toContain('2 of 21 requests failed');
    } finally {
      warn.mockRestore();
    }
  });

  it('logs the run even when saving fails', async () => {
    const { db, raw } = d1({ failPrices: true });
    await expect(runImport({ DB: db } as Env, new Date('2026-11-15T03:00:00Z'), openPrices().doFetch, { plan: PLAN, wait: noWait }))
      .rejects.toThrow('database is locked');
    expect(raw.prepare('SELECT requests, prices FROM imports').all()).toEqual([{ requests: CHAINS.length * 2, prices: 0 }]);
  });
});

describe('the importer fetch', () => {
  it('turns a request that hangs into a skipped page, cancelling it', async () => {
    let signal: AbortSignal | null = null;
    const hanging = ((_: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? null;
      return new Promise<Response>(() => undefined);
    }) as typeof fetch;
    const failures = { count: 0, last: null as string | null };
    const res = await sturdyFetch(hanging, failures, 20)('https://prices.test/x');
    expect(res.ok).toBe(false);
    expect(signal!.aborted).toBe(true);
    expect(failures).toEqual({ count: 1, last: 'timeout after 20 ms' });
  });

  it('cancels the body of an error answer and passes good JSON through', async () => {
    let cancelled = false;
    const body = new ReadableStream({ cancel() { cancelled = true; } });
    const failures = { count: 0, last: null as string | null };
    const bad = await sturdyFetch((async () => new Response(body, { status: 503 })) as typeof fetch, failures)('https://prices.test/x');
    expect(bad.status).toBe(503);
    expect(cancelled).toBe(true);
    const good = await sturdyFetch((async () => Response.json({ items: [1] })) as typeof fetch, failures)('https://prices.test/y');
    expect(await good.json()).toEqual({ items: [1] });
    expect(failures.count).toBe(1);
  });
});
