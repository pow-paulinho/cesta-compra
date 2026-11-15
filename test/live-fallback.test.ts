import { describe, expect, it } from 'vitest';
import { searchProducts } from '../src/api';
import {
  catalogueSearch, chainIdOf, eanVariants, fallbackOffers, likePatterns, rowToOffer, searchWords, wordPattern,
} from '../src/live/fallback';
import { seedDemo } from '../src/store';

/*
 * The SQL runs for real here: a D1 stand-in over Node's built-in SQLite, with the
 * schema from migrations/0001_prices.sql (read only). Loaded through
 * process.getBuiltinModule so neither Vite nor the Worker tsconfig needs to know it.
 */
interface SqliteDb { exec(sql: string): void; prepare(sql: string): { all(...v: unknown[]): unknown[]; run(...v: unknown[]): unknown } }
type Builtin = { getBuiltinModule?(id: string): unknown };
const proc = (globalThis as unknown as { process?: Builtin }).process;
const sqlite = proc?.getBuiltinModule?.('node:sqlite') as { DatabaseSync: new (p: string) => SqliteDb } | undefined;
const fs = proc?.getBuiltinModule?.('node:fs') as { readFileSync(p: URL, enc: 'utf8'): string } | undefined;
const here = (import.meta as unknown as { url: string }).url;

function d1(): { db: D1Database; raw: SqliteDb; sql: string[] } {
  const raw = new sqlite!.DatabaseSync(':memory:');
  raw.exec(fs!.readFileSync(new URL('../migrations/0001_prices.sql', here), 'utf8'));
  const sql: string[] = [];
  const statement = (q: string, v: unknown[] = []) => ({
    bind: (...b: unknown[]) => statement(q, b),
    all: async () => ({ results: raw.prepare(q).all(...v).map((r) => ({ ...(r as object) })) }),
    first: async () => ({ ...(raw.prepare(q).all(...v)[0] as object) }),
    run: async () => {
      raw.prepare(q).run(...v);
      return { success: true };
    },
  });
  const db = {
    prepare(q: string) {
      sql.push(q);
      return statement(q);
    },
    batch: async (stmts: Array<{ run(): Promise<unknown> }>) => {
      for (const s of stmts) await s.run();
      return [];
    },
  } as unknown as D1Database;
  return { db, raw, sql };
}

function seed(raw: SqliteDb) {
  const product = raw.prepare('INSERT INTO products (ean, name, brand, size) VALUES (?, ?, ?, ?)');
  const price = raw.prepare('INSERT INTO prices (ean, chain, source, price_cents, observed_on, place) VALUES (?, ?, ?, ?, ?, NULL)');
  product.run('8000000000001', 'Leche semidesnatada', 'Pascual', '1 l');
  product.run('8000000000002', 'Leche semidesnatada', 'Hacendado', '1 l');
  product.run('8000000000003', 'Leche semidesnatada sin lactosa', 'Hacendado', '1 l');
  product.run('8410173072025', 'Lasaña Fácil', 'Gallina Blanca', '200 g');
  product.run('8000000000004', 'Galletas 50% cacao', 'Marca', '200 g');
  product.run('8000000000005', 'Pan de molde', 'Bimbo', '450 g');
  price.run('8000000000001', 'Carrefour', 'open_prices', 120, '2026-08-01');
  price.run('8000000000001', 'El Corte Inglés', 'open_prices', 135, '2026-11-02');
  price.run('8000000000001', 'Dia', 'open_prices', 110, '2026-11-03');
  price.run('8000000000002', 'Mercadona', 'open_prices', 89, '2026-11-10');
  price.run('8000000000002', 'Mercadona', 'demo', 95, '2026-11-01');
  price.run('8000000000003', 'Mercadona', 'open_prices', 105, '2026-11-10');
  price.run('8410173072025', 'Mercadona', 'open_prices', 150, '2026-10-20');
  price.run('8000000000005', 'Mercadona', 'demo', 140, '2026-11-01');
}

describe.skipIf(!sqlite || !fs)('the D1 catalogue as a fallback', () => {
  it('maps catalogue chain names to chain ids, accents or not; other chains are none of ours', () => {
    expect(chainIdOf('El Corte Inglés')).toBe('supercor');
    expect(chainIdOf('El Corte Ingles')).toBe('supercor');
    expect(chainIdOf('Mercadona')).toBe('mercadona');
    expect(chainIdOf('BM')).toBe('bm');
    expect(chainIdOf('Dia')).toBeNull();
    expect(chainIdOf(null)).toBeNull();
  });

  it('builds LIKE patterns with escaped wildcards and accent-tolerant long words', () => {
    expect(wordPattern('leche')).toBe('%l_ch_%');
    expect(wordPattern('pan')).toBe('%pan%');
    expect(wordPattern('5%')).toBe('%5\\%%');
    expect(wordPattern('a_b%')).toBe('%_\\_b\\%%');
    expect(likePatterns('Leche semidesnatada de 1 L')).toEqual(['%l_ch_%', '%s_m_d_s__t_d_%']);
    expect(likePatterns('té')).toEqual(['%té%']);
    expect(likePatterns('x')).toEqual([]);
  });

  it('knows the ways an EAN may be stored', () => {
    expect(eanVariants('8410173072025')).toEqual(['8410173072025']);
    expect(eanVariants('12345678')).toEqual(['12345678', '0000012345678']);
    expect(eanVariants('0012345678905')).toEqual(['0012345678905', '12345678905']);
    expect(eanVariants('abc')).toEqual([]);
    expect(eanVariants(null)).toEqual([]);
  });

  it('turns a row into an Offer with unit price and date', () => {
    expect(rowToOffer({ ean: '8000000000001', name: 'Leche', brand: 'Pascual', size: '1 l', chain: 'Carrefour', source: 'open_prices', price_cents: 120, observed_on: '2026-08-01' }))
      .toEqual({
        chain: 'carrefour', id: '8000000000001', name: 'Leche', brand: 'Pascual', ean: '8000000000001', sizeText: '1 l',
        priceCents: 120, unitPriceCents: 120, unit: 'l', image: null, url: null, promo: null, source: 'open_prices', observedOn: '2026-08-01',
      });
    expect(rowToOffer({ ean: '1', name: 'x', brand: null, size: null, chain: 'Dia', source: 'open_prices', price_cents: 1, observed_on: '2026-01-01' })).toBeNull();
    expect(rowToOffer({ ean: '1', name: 'x', brand: null, size: null, chain: null, source: null, price_cents: null, observed_on: null })).toBeNull();
  });

  it('finds offers by EAN, and by name for the chains the EAN missed', async () => {
    const { db, raw } = d1();
    seed(raw);
    const wanted = { name: 'Leche semidesnatada Pascual 1 L', brand: 'Pascual', sizeText: '1 L', ean: '8000000000001' };
    const out = await fallbackOffers(db, wanted, ['carrefour', 'supercor', 'mercadona', 'lidl'], { mode: 'exact' });
    expect(out.carrefour!.map((o) => [o.id, o.priceCents, o.source, o.observedOn])).toEqual([['8000000000001', 120, 'open_prices', '2026-08-01']]);
    expect(out.supercor!.map((o) => o.priceCents)).toEqual([135]);
    // Mercadona has no row with that EAN, and no Pascual milk by name either (the brand
    // counts in exact mode, in the name or the brand column).
    expect(out.mercadona).toBeUndefined();
    expect(out.lidl).toBeUndefined();
    // Never a chain that was not asked for, and never one that is not ours.
    expect(Object.keys(out).sort()).toEqual(['carrefour', 'supercor']);
  });

  it('by name in exact mode, the brand must match too', async () => {
    const { db, raw, sql } = d1();
    seed(raw);
    const out = await fallbackOffers(db, { name: 'Leche semidesnatada', brand: 'Hacendado', sizeText: null, ean: null }, ['mercadona', 'carrefour']);
    expect(out.mercadona!.map((o) => o.brand)).toEqual(['Hacendado', 'Hacendado']);
    expect(out.carrefour).toBeUndefined();
    expect(sql).toHaveLength(1);
  });

  it('by name, a brand word matches the brand column too', async () => {
    const { db, raw } = d1();
    seed(raw);
    const out = await fallbackOffers(db, { name: 'Leche semidesnatada Hacendado', brand: 'Hacendado', sizeText: null, ean: null }, ['mercadona']);
    expect(out.mercadona!.map((o) => o.id).sort()).toEqual(['8000000000002', '8000000000003']);
  });

  it('keeps demo and real prices apart', async () => {
    const { db, raw } = d1();
    seed(raw);
    const wanted = { name: 'Leche semidesnatada', brand: 'Hacendado', sizeText: '1 l', ean: '8000000000002' };
    const real = await fallbackOffers(db, wanted, ['mercadona']);
    const demo = await fallbackOffers(db, wanted, ['mercadona'], { source: 'demo' });
    expect(real.mercadona!.map((o) => [o.priceCents, o.source])).toEqual([[89, 'open_prices']]);
    expect(demo.mercadona!.map((o) => [o.priceCents, o.source])).toEqual([[95, 'demo']]);
  });

  it('matches names whatever the accents', async () => {
    const { db, raw } = d1();
    seed(raw);
    const out = await fallbackOffers(db, { name: 'lasana facil', brand: null, sizeText: null, ean: null }, ['mercadona']);
    expect(out.mercadona!.map((o) => o.name)).toEqual(['Lasaña Fácil']);
  });

  it('in equivalent mode, also looks by name without the brand when the EAN was found', async () => {
    const { db, raw } = d1();
    seed(raw);
    const wanted = { name: 'Leche semidesnatada Pascual', brand: 'Pascual', sizeText: '1 l', ean: '8000000000001' };
    const out = await fallbackOffers(db, wanted, ['carrefour', 'mercadona'], { mode: 'equivalent' });
    expect(out.carrefour!.map((o) => o.brand)).toEqual(['Pascual']);
    expect(out.mercadona!.map((o) => o.brand)).toEqual(['Hacendado', 'Hacendado']);
  });

  it('searches the catalogue: our chains only, cheapest first, products without prices too', async () => {
    const { db, raw } = d1();
    seed(raw);
    const products = await catalogueSearch(db, 'leche semidesnatada');
    // Same name: the cheaper one first.
    expect(products.map((p) => p.ean)).toEqual(['8000000000002', '8000000000001', '8000000000003']);
    const pascual = products[1]!;
    expect(pascual.key).toBe('ean:8000000000001');
    expect(pascual.offers.map((o) => [o.chain, o.priceCents])).toEqual([['carrefour', 120], ['supercor', 135]]);
    // Pan de molde only has a demo price: without demo it is a card with no offers.
    const pan = await catalogueSearch(db, 'pan de molde');
    expect(pan).toHaveLength(1);
    expect(pan[0]!.offers).toEqual([]);
    const panDemo = await catalogueSearch(db, 'pan de molde', 'demo');
    expect(panDemo[0]!.offers.map((o) => [o.chain, o.source])).toEqual([['mercadona', 'demo']]);
  });

  it('searches by brand and by EAN; wildcards in the query match nothing', async () => {
    const { db, raw } = d1();
    seed(raw);
    expect((await catalogueSearch(db, 'hacendado')).map((p) => p.ean)).toEqual(['8000000000002', '8000000000003']);
    expect((await catalogueSearch(db, '8410173072025')).map((p) => p.name)).toEqual(['Lasaña Fácil']);
    expect(await catalogueSearch(db, '_%')).toEqual([]);
    expect(await catalogueSearch(db, '%%')).toEqual([]);
  });

  it('folds accents, ñ and plurals on both sides', async () => {
    expect(searchWords('Atún claro')).toEqual(['atun', 'claro']);
    expect(searchWords('huevos camperos')).toEqual(['huevo', 'campero']);
    expect(searchWords('té')).toEqual(['te']);
    const { db, raw } = d1();
    seed(raw);
    const product = raw.prepare('INSERT INTO products (ean, name, brand, size) VALUES (?, ?, ?, ?)');
    product.run('8000000000010', 'Atún claro en aceite de oliva', 'Calvo', '3 x 80 g');
    product.run('8000000000011', 'Huevo campero L', "Rio d'Oro", '12 ud');
    expect((await catalogueSearch(db, 'atun')).map((p) => p.ean)).toEqual(['8000000000010']);
    expect((await catalogueSearch(db, 'ATÚN Calvo')).map((p) => p.ean)).toEqual(['8000000000010']);
    expect((await catalogueSearch(db, 'lasana')).map((p) => p.name)).toEqual(['Lasaña Fácil']);
    expect((await catalogueSearch(db, 'huevos')).map((p) => p.ean)).toEqual(['8000000000011']);
    expect((await catalogueSearch(db, "rio d'oro")).map((p) => p.ean)).toEqual(['8000000000011']);
    // "leche" is not "lechuga" any more.
    product.run('8000000000012', 'Lechuga iceberg', null, null);
    expect((await catalogueSearch(db, 'leche')).map((p) => p.name)).not.toContain('Lechuga iceberg');
  });

  it('finds the priced products of a short query after the demo set is seeded (atún)', async () => {
    const { db, raw } = d1();
    await seedDemo(db);
    const product = raw.prepare('INSERT INTO products (ean, name, brand, size) VALUES (?, ?, ?, ?)');
    const price = raw.prepare('INSERT INTO prices (ean, chain, source, price_cents, observed_on, place) VALUES (?, ?, ?, ?, ?, NULL)');
    product.run('8410000810004', 'Atún claro en aceite de girasol', 'Calvo', '3 x 65 g');
    product.run('8480000105767', 'Atún claro al natural', 'Hacendado', '3 x 52 g');
    product.run('8410000000001', 'Leche entera', 'Pascual', '1 l');
    product.run('8410000000002', 'Galletas maría', 'Fontaneda', '800 g');
    product.run('8410000000003', 'Tomate frito', 'Orlando', '350 g');
    price.run('8410000810004', 'Carrefour', 'open_prices', 389, '2026-11-02');
    price.run('8480000105767', 'Mercadona', 'open_prices', 215, '2026-11-10');
    price.run('8410000000001', 'Mercadona', 'open_prices', 105, '2026-11-10');
    price.run('8410000000002', 'Lidl', 'open_prices', 199, '2026-11-08');
    price.run('8410000000003', 'BM', 'open_prices', 129, '2026-11-01');
    const found = await catalogueSearch(db, 'atún', 'open_prices');
    expect(found.slice(0, 2).map((p) => p.ean).sort()).toEqual(['8410000810004', '8480000105767']);
    expect(found.slice(0, 2).every((p) => p.offers.length === 1)).toBe(true);
    // Nothing that merely shares letters with "atun" (Nutella, Tortiglioni...).
    for (const p of found) expect(`${p.name} ${p.brand ?? ''}`.toLowerCase()).toMatch(/at[uú]n/);
  });

  it('chooses which products to show among the priced ones before the cut, not in table order', async () => {
    const { db, raw } = d1();
    const product = raw.prepare('INSERT INTO products (ean, name, brand, size) VALUES (?, ?, ?, ?)');
    const price = raw.prepare('INSERT INTO prices (ean, chain, source, price_cents, observed_on, place) VALUES (?, ?, ?, ?, ?, NULL)');
    // 40 matches first in table order: no price, or a price at a chain that is not ours.
    for (let i = 0; i < 40; i++) {
      const ean = String(8100000000000 + i);
      product.run(ean, `Leche de avena sabor ${i}`, null, '1 l');
      if (i % 2) price.run(ean, 'Dia', 'open_prices', 150, '2026-11-12');
    }
    product.run('8410000000001', 'Leche entera', 'Pascual', '1 l');
    price.run('8410000000001', 'Mercadona', 'open_prices', 105, '2026-11-10');
    product.run('8410000000002', 'Batido con leche', 'Puleva', '1 l');
    price.run('8410000000002', 'Lidl', 'open_prices', 99, '2026-11-11');
    const found = await catalogueSearch(db, 'leche', 'open_prices');
    expect(found).toHaveLength(30);
    // Priced first; among them the one whose name starts with the word, then the other.
    expect(found.slice(0, 2).map((p) => p.ean)).toEqual(['8410000000001', '8410000000002']);
    expect(found.slice(2).every((p) => p.offers.length === 0)).toBe(true);
  });

  it('the older /api/products search also picks priced products before its cut', async () => {
    const { db, raw } = d1();
    const product = raw.prepare('INSERT INTO products (ean, name, brand, size) VALUES (?, ?, ?, ?)');
    const price = raw.prepare('INSERT INTO prices (ean, chain, source, price_cents, observed_on, place) VALUES (?, ?, ?, ?, ?, NULL)');
    for (let i = 0; i < 40; i++) product.run(String(8100000000000 + i), `Leche sin precio ${i}`, null, '1 l');
    product.run('8410000000001', 'Leche entera', 'Pascual', '1 l');
    price.run('8410000000001', 'Mercadona', 'open_prices', 105, '2026-11-10');
    const r = await searchProducts(db, 'leche', new Date('2026-11-15T00:00:00Z'));
    expect(r.products.map((p) => p.ean)).toEqual(['8410000000001']);
  });
});
