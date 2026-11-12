---
id: CC-3
title: The daily import is cut off after 30 seconds: the cron hands it to waitUntil, so the Open Prices half never finishes
state: Done
plan_task: —
owner: paulo@commitcycle.com
mode: standard
topics: []
branch: task/CC-3-the-daily-import-is-cut-off-after-30-sec
time_box: null
quality_gate: regression suite
priority: urgent
created: 2026-11-12
---

# CC-3 · The daily import is cut off after 30 seconds: the cron hands it to waitUntil, so the Open Prices half never finishes

Record written at birth by `cycle start` (CC-111) — the D-43 orphan pattern
ends where this command begins.

## Goal

The scheduled handler awaits the whole import instead of passing it to waitUntil, so the polite Open Prices reader (about 45 s at 1.1 s per request) completes and logs its run.

## Non-goals

No change to what is fetched, to the pace, or to the schema.

## Affected zones

None (unprotected paths).

## Acceptance criteria

- [ ] scheduled() awaits runImport; a unit test proves the import has finished when scheduled() resolves.
- [ ] After one run in production, /api/status lists open_prices rows per chain and an imports row.

## Hand-in

### Done
- scheduled() awaits runImport instead of waitUntil (waitUntil was cancelled ~30 s after return; the polite reader needs ~45 s).
### Verification
- test/scheduled.test.ts: the import log is written before scheduled() resolves. 9/9 tests, tsc clean. Production run after merge.
### Criteria
1. test/scheduled.test.ts
2. after deploy

---

## History

| When | State | Note |
|---|---|---|
| 2026-11-12 | Triage | `cycle start` |
| 2026-11-12 | Todo | Scoped in the same command |
| 2026-11-12 | In Progress | Gate passed; grant bound to this branch |
