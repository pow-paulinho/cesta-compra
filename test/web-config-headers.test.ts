import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** Parses a Workers static-assets `_headers` file into { path pattern: { header: value } }. */
function parseHeaders(text: string): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {};
  let current: Record<string, string> | null = null;
  for (const line of text.split('\n')) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = rules[line.trim()] = {};
      continue;
    }
    const at = line.indexOf(':');
    if (!current || at < 0) throw new Error(`bad _headers line: ${line}`);
    current[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim();
  }
  return rules;
}

const all = parseHeaders(read('web/public/_headers'))['/*'] ?? {};
const csp = Object.fromEntries(
  (all['content-security-policy'] ?? '')
    .split(';')
    .map((d) => d.trim().split(/\s+/))
    .filter((d) => d[0])
    .map(([name, ...sources]) => [name, sources]),
);

describe('web/public/_headers (applied by Workers static assets to the app)', () => {
  it('has one rule for every path', () => {
    expect(Object.keys(all).length).toBeGreaterThan(0);
  });

  it('only runs our own scripts: no inline, no eval, no plugins, no <base> tricks', () => {
    expect(csp['default-src']).toEqual(["'self'"]);
    expect(csp['script-src']).toEqual(["'self'"]);
    expect(csp['object-src']).toEqual(["'none'"]);
    expect(csp['base-uri']).toEqual(["'none'"]);
    expect(all['content-security-policy']).not.toMatch(/unsafe-eval|\*/);
  });

  it('lets the app work: inline styles (motion), https and data: product images, the self-hosted font, its own API', () => {
    expect(csp['style-src']).toEqual(expect.arrayContaining(["'self'", "'unsafe-inline'"]));
    expect(csp['img-src']).toEqual(expect.arrayContaining(["'self'", 'https:', 'data:']));
    expect(csp['img-src']).not.toContain('http:');
    expect(csp['font-src']).toEqual(["'self'"]);
    expect(csp['connect-src']).toEqual(["'self'"]);
  });

  it('cannot be framed, sends no referrer to image CDNs and stops MIME sniffing', () => {
    expect(csp['frame-ancestors']).toEqual(["'none'"]);
    expect(all['x-frame-options']).toBe('DENY');
    expect(all['referrer-policy']).toBe('no-referrer');
    expect(all['x-content-type-options']).toBe('nosniff');
  });
});

describe('web/index.html', () => {
  const html = read('web/index.html');

  it('asks for no referrer too (the dev server and any host without _headers)', () => {
    expect(html).toMatch(/<meta name="referrer" content="no-referrer"\s*\/?>/);
  });

  it('has no inline script the CSP would block (script-src is only self)', () => {
    for (const tag of html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) ?? []) {
      expect(tag).toMatch(/\bsrc="/);
      expect(tag.replace(/<script\b[^>]*>|<\/script>/g, '').trim()).toBe('');
    }
  });
});
