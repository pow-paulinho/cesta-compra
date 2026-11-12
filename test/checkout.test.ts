import { describe, expect, it } from 'vitest';
import { parseCart } from '../src/api';
import worker, { page, type Env } from '../src/index';

describe('checkout input', () => {
  it('accepts a cart, a cap and a source', () => {
    expect(parseCart({ items: [{ ean: '8076809579346', qty: 2 }], maxStores: 2, source: 'open_prices' }))
      .toEqual({ items: [{ ean: '8076809579346', qty: 2 }], maxStores: 2, source: 'open_prices' });
    expect(parseCart({ items: [{ ean: '8076809579346', qty: 1 }] })).toMatchObject({ maxStores: 7, source: 'demo' });
  });

  it('refuses bad EANs, quantities, caps and shapes', () => {
    expect(parseCart({ items: [{ ean: 'abc', qty: 1 }] })).toBeNull();
    expect(parseCart({ items: [{ ean: '8076809579346', qty: 0 }] })).toBeNull();
    expect(parseCart({ items: [{ ean: '8076809579346', qty: 1 }], maxStores: 9 })).toBeNull();
    expect(parseCart(null)).toBeNull();
  });

  it('answers 400 with what is accepted', async () => {
    const res = await worker.fetch(new Request('https://x.test/api/checkout', { method: 'POST', body: '{"items":"x"}' }), {} as Env);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toContain('maxStores');
  });

  it('puts the checkout on the page', () => {
    expect(page()).toContain('id="go"');
    const js = page().split('<script>')[1]!.split('</script>')[0]!;
    expect(() => new Function(js)).not.toThrow();
  });
});
