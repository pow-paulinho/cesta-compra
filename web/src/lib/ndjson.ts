/**
 * Reads an NDJSON stream line by line as it arrives, calling `onLine` with each
 * parsed object. Bad lines are skipped (reported through `onBadLine`).
 */
export async function readNdjson<T>(
  body: ReadableStream<Uint8Array>,
  onLine: (value: T) => void,
  onBadLine?: (line: string) => void,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const flush = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      onLine(JSON.parse(trimmed) as T);
    } catch {
      onBadLine?.(trimmed);
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      flush(buffer.slice(0, nl));
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  flush(buffer);
}

/** The `{ error }` message of a failed JSON response, or a generic one. */
export async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body.error === 'string' && body.error) return body.error;
  } catch {
    /* not JSON */
  }
  if (res.status >= 500) return 'El servidor ha fallado. Vuelve a intentarlo en un momento.';
  if (res.status === 429) return 'Demasiadas búsquedas seguidas. Espera unos segundos y vuelve a probar.';
  return `La petición ha fallado (${res.status}).`;
}

export const NETWORK_ERROR = 'No hay conexión con el servidor. Revisa tu conexión y vuelve a intentarlo.';
