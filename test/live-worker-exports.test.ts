import { describe, expect, it } from 'vitest';
import * as main from '../src/index';
import { CHECKOUT_MAX_BYTES, IMPORT_REQUEST_TIMEOUT_MS } from '../src/limits';

describe("the Worker's main module", () => {
  it('exports only functions besides the default handler (workerd refuses constants)', () => {
    for (const [name, value] of Object.entries(main)) {
      if (name === 'default') continue;
      expect(typeof value, `export ${name}`).toBe('function');
    }
  });

  it('exports a default handler with fetch and scheduled', () => {
    expect(typeof main.default.fetch).toBe('function');
    expect(typeof main.default.scheduled).toBe('function');
  });

  it('keeps its limits in src/limits.ts', () => {
    expect(CHECKOUT_MAX_BYTES).toBe(8 * 1024);
    expect(IMPORT_REQUEST_TIMEOUT_MS).toBe(15_000);
  });
});
