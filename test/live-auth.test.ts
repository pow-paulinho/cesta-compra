import { describe, expect, it, vi } from 'vitest';
import { constantTimeEqual, liveAccess, liveAllowed, lockedReason } from '../src/live/auth';
import worker, { type Env } from '../src/index';

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
