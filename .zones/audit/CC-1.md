---
task: CC-1
title: "Scaffold the Worker with a health route, and a CI workflow that runs the tests and the typecheck on every pull request"
owner: paulo@commitcycle.com
mode: standard
branch: task/CC-1-scaffold-the-worker-with-a-health-route-
quality_gate: regression suite
zones_declared: []
zones_touched: []
declaration_matches: true
exceptions: 2
blocks: 0
mutations_observed: 8
evidence:
  - type: url
    location: https://github.com/pow-paulinho/cesta-compra/actions/runs/42992624297
    by: paulo@commitcycle.com
    at: 2026-11-11 UTC
diff:
  files: 9
  base: f95a7ea6
  head: ee8caaad
opened: 2026-11-11 UTC
closed: 2026-11-11 UTC
closed_by: paulo@commitcycle.com
---

# CC-1 — audit record

## What was asked

A Cloudflare Worker project (TypeScript, wrangler.jsonc) that answers GET /health with JSON, unit tests with vitest, tsc typecheck, and a GitHub Actions workflow running both on pull requests and pushes to main.

## What it was not allowed to do

No database, no price sources, no UI yet. No deploy from CI.

## How anyone would know it worked

- GET /health answers 200 with {ok:true, app:'cesta-compra'}, covered by a unit test.
- npm test and npm run typecheck pass locally and in the CI workflow on the pull request.

## Exceptions

- **2026-11-11 UTC** — at close, 9 changed file(s) are in no zone: package.json, tsconfig.json, wrangler.jsonc, .github/workflows/ci.yml, src/index.ts and 4 more. Should any be protected? `cycle protect <glob> --zone <id>` if yes, `cycle dismiss <glob>` to stop being asked.
- **2026-11-11 UTC** — at close, Nothing observed this work: 9 changed file(s) and no mutation events at all (package.json, tsconfig.json, wrangler.jsonc and 6 more). That is what a hand-edited task looks like — but it is also what a task run with the hook switched off looks like, and from here they are the same.

## What changed

9 file(s) between `f95a7ea6` and `ee8caaad`.

- `package.json` (A)
- `tsconfig.json` (A)
- `wrangler.jsonc` (A)
- `.github/workflows/ci.yml` (A)
- `src/index.ts` (A)
- `test/health.test.ts` (A)
- `.zones/tasks/CC-1.md` (A)
- `.gitignore` (M)
- `AGENTS.md` (M)

## Files that define the guard

These decide what every other check in this repository is checking, and this task changed them. Acknowledged by machine:BigMac-Paulo · cesta: ci.yml is the deliverable: the first CI workflow of the repository (typecheck + tests)

- `.github/workflows/ci.yml` (A) — the CI job: the checks nobody runs locally
