import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/sources/openprices', () => ({
  fetchOpenPrices: vi.fn(async () => {
    await new Promise((r) => setTimeout(r, 20));
    return { prices: [], requests: 3, skipped: 1 };
  }),
}));
const logged: unknown[] = [];
vi.mock('../src/store', () => ({
  seedDemo: vi.fn(async () => 5),
  saveOpenPrices: vi.fn(async () => 0),
  logImport: vi.fn(async (...args: unknown[]) => { logged.push(args); }),
  status: vi.fn(),
}));

describe('the daily cron', () => {
  it('has finished the whole import, log included, when scheduled() resolves', async () => {
    const worker = (await import('../src/index')).default;
    await worker.scheduled!({} as ScheduledController, { DB: {} as D1Database });
    expect(logged).toHaveLength(1);
  });
});
