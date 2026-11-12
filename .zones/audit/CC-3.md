---
task: CC-3
title: "The daily import is cut off after 30 seconds: the cron hands it to waitUntil, so the Open Prices half never finishes"
owner: paulo@commitcycle.com
mode: standard
branch: task/CC-3-the-daily-import-is-cut-off-after-30-sec
quality_gate: regression suite
zones_declared: []
zones_touched: []
declaration_matches: true
exceptions: 2
blocks: 0
mutations_observed: 2
evidence:
  - type: url
    location: https://github.com/pow-paulinho/cesta-compra/actions/runs/43204898701
    by: paulo@commitcycle.com
    at: 2026-11-12 UTC
  - type: url
    location: https://cesta-compra.pow-995.workers.dev/api/status
    by: paulo@commitcycle.com
    at: 2026-11-12 UTC
diff:
  files: 3
  base: 76aadef8
  head: 8ea1e0b0
opened: 2026-11-12 UTC
closed: 2026-11-12 UTC
closed_by: paulo@commitcycle.com
---

# CC-3 — audit record

## What was asked

The scheduled handler awaits the whole import instead of passing it to waitUntil, so the polite Open Prices reader (about 45 s at 1.1 s per request) completes and logs its run.

## What it was not allowed to do

No change to what is fetched, to the pace, or to the schema.

## How anyone would know it worked

- scheduled() awaits runImport; a unit test proves the import has finished when scheduled() resolves.
- After one run in production, /api/status lists open_prices rows per chain and an imports row.

## Exceptions

- **2026-11-12 UTC** — at close, 3 changed file(s) are in no zone: .zones/tasks/CC-3.md, src/index.ts, test/scheduled.test.ts. Should any be protected? `cycle protect <glob> --zone <id>` if yes, `cycle dismiss <glob>` to stop being asked.
- **2026-11-12 UTC** — at close, Nothing observed this work: 3 changed file(s) and no mutation events at all (.zones/tasks/CC-3.md, src/index.ts, test/scheduled.test.ts). That is what a hand-edited task looks like — but it is also what a task run with the hook switched off looks like, and from here they are the same.

## What changed

3 file(s) between `76aadef8` and `8ea1e0b0`.

- `.zones/tasks/CC-3.md` (A)
- `src/index.ts` (M)
- `test/scheduled.test.ts` (A)
