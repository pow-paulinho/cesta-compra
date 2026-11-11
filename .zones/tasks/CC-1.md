---
id: CC-1
title: Scaffold the Worker with a health route, and a CI workflow that runs the tests and the typecheck on every pull request
state: In Progress
plan_task: —
owner: paulo@commitcycle.com
mode: standard
topics: []
branch: task/CC-1-scaffold-the-worker-with-a-health-route-
time_box: null
quality_gate: regression suite
priority: high
created: 2026-11-11
---

# CC-1 · Scaffold the Worker with a health route, and a CI workflow that runs the tests and the typecheck on every pull request

Record written at birth by `cycle start` (CC-111) — the D-43 orphan pattern
ends where this command begins.

## Goal

A Cloudflare Worker project (TypeScript, wrangler.jsonc) that answers GET /health with JSON, unit tests with vitest, tsc typecheck, and a GitHub Actions workflow running both on pull requests and pushes to main.

## Non-goals

No database, no price sources, no UI yet. No deploy from CI.

## Affected zones

None (unprotected paths).

## Acceptance criteria

- [ ] GET /health answers 200 with {ok:true, app:'cesta-compra'}, covered by a unit test.
- [ ] npm test and npm run typecheck pass locally and in the CI workflow on the pull request.

---

## History

| When | State | Note |
|---|---|---|
| 2026-11-11 | Triage | `cycle start` |
| 2026-11-11 | Todo | Scoped in the same command |
| 2026-11-11 | In Progress | Gate passed; grant bound to this branch |
