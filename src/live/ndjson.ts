/**
 * Newline-delimited JSON streaming: one JSON value per line, each line written (and so
 * sent) as soon as it is ready. The response is returned at once; the work keeps running
 * while the body streams, and a client that goes away only stops the writing.
 */
export const NDJSON_TYPE = 'application/x-ndjson; charset=utf-8';

export type Emit = (value: unknown) => Promise<void>;

export interface NdjsonStream {
  response: Response;
  /** Settles when the work has finished and the stream is closed; never rejects. */
  done: Promise<void>;
}

/** One line of NDJSON for a value. */
export function ndjsonLine(value: unknown): string {
  return `${JSON.stringify(value)}\n`;
}

export function ndjsonStream(run: (emit: Emit) => Promise<void>, onError?: (err: unknown) => void): NdjsonStream {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let open = true;
  let chain = Promise.resolve();

  // Writes are chained so lines never interleave, whatever the callers do.
  const emit: Emit = (value) => {
    const line = encoder.encode(ndjsonLine(value));
    chain = chain.then(async () => {
      if (!open) return;
      try {
        await writer.write(line);
      } catch {
        open = false;
      }
    });
    return chain;
  };

  const done = (async () => {
    try {
      await run(emit);
    } catch (err) {
      onError?.(err);
    } finally {
      await chain;
      if (open) await writer.close().catch(() => undefined);
    }
  })();

  const response = new Response(readable, {
    headers: {
      'content-type': NDJSON_TYPE,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
  return { response, done };
}

/** Parses an NDJSON body (for tests and tools). Blank lines are skipped. */
export function parseNdjson<T = unknown>(text: string): T[] {
  return text.split('\n').filter((l) => l.trim() !== '').map((l) => JSON.parse(l) as T);
}
