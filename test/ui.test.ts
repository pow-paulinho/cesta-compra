import { describe, expect, it } from 'vitest';
import worker, { page, type Env } from '../src/index';

describe('the page', () => {
  it('is served at / as HTML in Spanish, with the search and the cart', async () => {
    const res = await worker.fetch(new Request('https://x.test/'), {} as Env);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).toContain('<html lang="es">');
    expect(html).toContain('id="q"');
    expect(html).toContain('id="cart"');
  });

  it('labels demo and Open Prices prices, and marks old ones', () => {
    expect(page()).toContain('tag demo');
    expect(page()).toContain('Open Prices · ');
    expect(page()).toContain('antiguo');
  });

  it('ships a script that parses', () => {
    const js = page().split('<script>')[1]!.split('</script>')[0]!;
    expect(() => new Function(js)).not.toThrow();
  });

  it('answers 404 for unknown paths', async () => {
    expect((await worker.fetch(new Request('https://x.test/nope'), {} as Env)).status).toBe(404);
  });
});
