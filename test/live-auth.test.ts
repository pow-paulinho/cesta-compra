import { describe, expect, it, vi } from 'vitest';
import { constantTimeEqual, liveAccess, liveAllowed, lockedReason } from '../src/live/auth';
import worker, { type Env } from '../src/index';
import { KeyThrottle, WRONG_KEY_LIMIT, WRONG_KEY_WINDOW_MS } from '../src/live/auth';

const req = (key?: string) => new Request('https://x.test/api/live', { headers: key === undefined ? {} : { 'x-live-key': key } });

describe('the live key', () => {
  it('compares over UTF-8 bytes, lengths included', () => {
    expect(constantTimeEqual('cambia-esto', 'cambia-esto')).toBe(true);
    expect(constantTimeEqual('cambia-esto', 'cambia-estO')).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
    expect(constantTimeEqual('', 'a')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
    // Same length in characters, different bytes: n with tilde is two bytes in UTF-8.
    expect(constantTimeEqual('año', 'ano')).toBe(false);
    expect(constantTimeEqual('año', 'año')).toBe(true);
  });

  it('is off for everyone when the server has no key', () => {
    expect(liveAccess({}, req('lo-que-sea'))).toBe('disabled');
    expect(liveAccess({ LIVE_KEY: '   ' }, req(''))).toBe('disabled');
    expect(liveAllowed({}, req('lo-que-sea'))).toBe(false);
  });

  it('needs the same key in x-live-key', () => {
    const env = { LIVE_KEY: 'cambia-esto' };
    expect(liveAccess(env, req())).toBe('missing');
    expect(liveAccess(env, req('otra'))).toBe('wrong');
    expect(liveAccess(env, req('cambia-esto'))).toBe('ok');
    expect(liveAllowed(env, req('cambia-esto'))).toBe(true);
    // A secret saved with a trailing newline still matches.
    expect(liveAllowed({ LIVE_KEY: 'cambia-esto\n' }, req('cambia-esto'))).toBe(true);
  });

  it('says why a chain is locked, in Spanish, without the key', () => {
    expect(lockedReason('missing', 'Alcampo')).toContain('clave');
    expect(lockedReason('wrong', 'Alcampo')).toContain('no coincide');
    expect(lockedReason('disabled', 'Alcampo')).toContain('no está activada');
  });

  it('GET /api/live reports live only with the matching key, and never echoes or logs it', async () => {
    const log = vi.spyOn(console, 'log');
    const err = vi.spyOn(console, 'error');
    const env = { LIVE_KEY: 'secreto-123' } as Env;
    const off = await worker.fetch(req('mal'), env);
    const offBody = await off.text();
    expect(JSON.parse(offBody)).toMatchObject({ live: false, access: 'wrong' });
    expect(offBody).not.toContain('secreto-123');
    const on = await worker.fetch(req('secreto-123'), env);
    const onBody = await on.text();
    expect(JSON.parse(onBody)).toMatchObject({ live: true, access: 'ok' });
    expect(onBody).not.toContain('secreto-123');
    expect(on.headers.get('cache-control')).toBe('no-store');
    for (const call of [...log.mock.calls, ...err.mock.calls]) expect(JSON.stringify(call)).not.toContain('secreto-123');
    log.mockRestore();
    err.mockRestore();
  });

  it('GET /api/live lists all 8 chains, each with a reason when it is not searched live', async () => {
    const res = await worker.fetch(req(), {} as Env);
    const body = (await res.json()) as { live: boolean; chains: Array<{ id: string; mode: string; reason?: string }> };
    expect(body.live).toBe(false);
    expect(body.chains.map((c) => c.id)).toEqual(['mercadona', 'carrefour', 'alcampo', 'aldi', 'lidl', 'ahorramas', 'supercor', 'bm']);
    for (const c of body.chains) if (c.mode === 'fallback') expect(c.reason).toBeTruthy();
  });
});

describe('guessing the key online', () => {
  const from = (ip: string, path: string, key: string) => new Request(`https://x.test${path}`, { headers: { 'x-live-key': key, 'cf-connecting-ip': ip } });

  it('after 10 wrong keys a client gets 429 on every route that reads the key; others are not affected', async () => {
    const env = { LIVE_KEY: 'una-clave-larga-y-secreta' } as Env;
    for (let i = 0; i < WRONG_KEY_LIMIT; i++) {
      const res = await worker.fetch(from('203.0.113.7', '/api/live', `intento-${i}`), env);
      expect(((await res.json()) as { access: string }).access).toBe('wrong');
    }
    for (const path of ['/api/live', '/api/search?q=leche']) {
      const res = await worker.fetch(from('203.0.113.7', path, 'una-clave-larga-y-secreta'), env);
      expect(res.status).toBe(429);
      expect(Number(res.headers.get('retry-after'))).toBeGreaterThan(0);
      expect(((await res.json()) as { error: string }).error).toContain('Demasiados intentos');
    }
    const hunt = await worker.fetch(new Request('https://x.test/api/hunt', {
      method: 'POST', body: '{}', headers: { 'x-live-key': 'otra', 'cf-connecting-ip': '203.0.113.7' },
    }), env);
    expect(hunt.status).toBe(429);
    // Another client, and the same client without a key, still get their answers.
    const other = await worker.fetch(from('198.51.100.20', '/api/live', 'una-clave-larga-y-secreta'), env);
    expect(((await other.json()) as { access: string }).access).toBe('ok');
    const noKey = await worker.fetch(new Request('https://x.test/api/live', { headers: { 'cf-connecting-ip': '203.0.113.7' } }), env);
    expect(noKey.status).toBe(200);
  });

  it('the right key never counts, and old attempts leave the window', () => {
    const t = new KeyThrottle(3, 1000);
    t.recordWrong('a', 0);
    t.recordWrong('a', 100);
    expect(t.waitMs('a', 200)).toBe(0);
    t.recordWrong('a', 200);
    expect(t.waitMs('a', 300)).toBe(700);
    expect(t.waitMs('a', 1000)).toBe(0);
    expect(WRONG_KEY_WINDOW_MS).toBe(15 * 60_000);
  });
});

