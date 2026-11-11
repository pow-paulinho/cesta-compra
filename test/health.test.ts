import { describe, expect, it } from 'vitest';
import worker, { health } from '../src/index';

describe('health', () => {
  it('names the app', () => {
    expect(health()).toEqual({ ok: true, app: 'cesta-compra' });
  });

  it('answers /health with JSON', async () => {
    const res = await worker.fetch(new Request('https://x.test/health'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, app: 'cesta-compra' });
  });
});
