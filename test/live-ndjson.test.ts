import { describe, expect, it } from 'vitest';
import { ndjsonLine, ndjsonStream, parseNdjson } from '../src/live/ndjson';

const later = <T>(ms: number, v: T) => new Promise<T>((r) => setTimeout(() => r(v), ms));

describe('NDJSON streaming', () => {
  it('writes one JSON value per line, each ending in a newline', async () => {
    const { response, done } = ndjsonStream(async (emit) => {
      await emit({ a: 1, s: 'línea con\nsalto' });
      await emit({ type: 'done' });
    });
    expect(response.headers.get('content-type')).toBe('application/x-ndjson; charset=utf-8');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const text = await response.text();
    await done;
    expect(text.endsWith('\n')).toBe(true);
    expect(text.split('\n')).toHaveLength(3);
    expect(parseNdjson(text)).toEqual([{ a: 1, s: 'línea con\nsalto' }, { type: 'done' }]);
    expect(ndjsonLine({ x: 'y' })).toBe('{"x":"y"}\n');
  });

  it('emits in the order work finishes, never interleaving lines', async () => {
    const { response } = ndjsonStream(async (emit) => {
      await Promise.all([
        later(30, 'slow').then((s) => emit({ s })),
        later(1, 'fast').then((s) => emit({ s })),
        later(10, 'mid').then((s) => emit({ s, big: 'x'.repeat(50_000) })),
      ]);
      await emit({ s: 'done' });
    });
    const events = parseNdjson<{ s: string }>(await response.text());
    expect(events.map((e) => e.s)).toEqual(['fast', 'mid', 'slow', 'done']);
  });

  it('sends a line before the rest of the work has finished', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { response } = ndjsonStream(async (emit) => {
      await emit({ n: 1 });
      await gate;
      await emit({ n: 2 });
    });
    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toBe('{"n":1}\n');
    release();
    let rest = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      rest += new TextDecoder().decode(value);
    }
    expect(rest).toBe('{"n":2}\n');
  });

  it('closes the stream when the work throws, after what was already sent', async () => {
    const errors: unknown[] = [];
    const { response, done } = ndjsonStream(async (emit) => {
      await emit({ n: 1 });
      throw new Error('boom');
    }, (e) => errors.push(e));
    expect(parseNdjson(await response.text())).toEqual([{ n: 1 }]);
    await done;
    expect(errors).toHaveLength(1);
  });

  it('stops writing quietly when the client goes away', async () => {
    const { response, done } = ndjsonStream(async (emit) => {
      for (let i = 0; i < 5; i++) await emit({ i });
    });
    await response.body!.cancel();
    await expect(done).resolves.toBeUndefined();
  });
});
