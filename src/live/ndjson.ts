/**
 * Newline-delimited JSON streaming: one JSON value per line, each line written (and so
 * sent) as soon as it is ready. The response is returned at once; the work keeps running
 * while the body streams. A client that goes away stops the writing and aborts the signal
 * the work receives, so the routes call off requests to the shops nobody will read.
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

export function ndjsonStream(run: (emit: Emit, signal: AbortSignal) => Promise<void>, onError?: (err: unknown) => void): NdjsonStream {
  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  const gone = new AbortController();
  let open = true;
  let chain = Promise.resolve();
  const lost = () => {
    open = false;
    if (!gone.signal.aborted) gone.abort(new Error('client went away'));
  };
  // The readable side cancelled (the client disconnected) errors the writer at once.
  writer.closed.catch(lost);

  // Writes are chained so lines never interleave, whatever the callers do.
  const emit: Emit = (value) => {
    const line = encoder.encode(ndjsonLine(value));
    chain = chain.then(async () => {
      if (!open) return;
      try {
        await writer.write(line);
      } catch {
        lost();
      }
    });
    return chain;
  };

  const done = (async () => {
    try {
      await run(emit, gone.signal);
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
