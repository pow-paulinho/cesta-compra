import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('..', import.meta.url));

/** True when .gitignore keeps `path` out of git (checked by git itself, tracked or not). */
function ignored(path: string): boolean {
  const r = spawnSync('git', ['check-ignore', '--no-index', '-q', path], { cwd: root });
  if (r.status !== 0 && r.status !== 1) throw new Error(`git check-ignore failed: ${r.stderr}`);
  return r.status === 0;
}

describe('.gitignore keeps local secrets out of git', () => {
  it.each(['.dev.vars', '.dev.vars.production', '.dev.vars.staging', '.env', '.env.local', '.env.production'])(
    'ignores %s',
    (path) => expect(ignored(path)).toBe(true),
  );

  it.each(['.dev.vars.example', '.env.example'])('still commits the example %s', (path) => {
    expect(ignored(path)).toBe(false);
  });
});
