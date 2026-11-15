import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => JSON.parse(readFileSync(new URL(`../${p}`, import.meta.url), 'utf8'));
const pkg = read('package.json') as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
  dependencies?: Record<string, string>;
};
const lock = read('package-lock.json') as { packages: Record<string, { version?: string }> };

describe('wrangler is pinned and locked', () => {
  const pinned = pkg.devDependencies.wrangler;

  it('is a devDependency at one exact 4.x version (no range)', () => {
    expect(pinned).toMatch(/^4\.\d+\.\d+$/);
    expect(pkg.dependencies?.wrangler).toBeUndefined();
  });

  it('is in the lockfile at that same version, so npm ci installs exactly it', () => {
    expect(lock.packages['']).toMatchObject({ devDependencies: { wrangler: pinned } });
    expect(lock.packages['node_modules/wrangler']?.version).toBe(pinned);
  });

  it('is what the dev and deploy scripts run (the local bin, never a fresh npx download)', () => {
    expect(pkg.scripts.dev).toBe('wrangler dev');
    expect(pkg.scripts.deploy).toBe('wrangler deploy');
    for (const [name, cmd] of Object.entries(pkg.scripts)) {
      expect(cmd, `script ${name}`).not.toMatch(/npx\s+(--yes\s+)?wrangler@|wrangler@\d/);
    }
  });
});
