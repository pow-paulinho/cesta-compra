---
task: CC-2
title: "Import prices once a day: Open Prices for Spanish supermarkets, politely, plus a seeded and labelled demo price set"
owner: paulo@commitcycle.com
mode: standard
branch: task/CC-2-import-prices-once-a-day-open-prices-for
quality_gate: regression suite
zones_declared: [sources:write]
zones_amended: [schema:write]
zones_touched: [schema, sources]
declaration_matches: true
exceptions: 4
blocks: 0
mutations_observed: 4
evidence:
  - type: url
    location: https://github.com/pow-paulinho/cesta-compra/actions/runs/43204356301
    by: paulo@commitcycle.com
    at: 2026-11-12 UTC
  - type: url
    location: https://cesta-compra.pow-995.workers.dev/api/status
    by: paulo@commitcycle.com
    at: 2026-11-12 UTC
diff:
  files: 13
  base: 2a9787c7
  head: 9b40fec8
opened: 2026-11-11 UTC
closed: 2026-11-12 UTC
closed_by: paulo@commitcycle.com
---

# CC-2 — audit record

## What was asked

A D1 schema (products by EAN, one price per product, chain and source, import log) and a daily cron that seeds about 50 demo products in 5 chains (source demo) and reads Open Prices for Spanish locations of Mercadona, Dia, Consum, Carrefour, Alcampo, Eroski and Lidl, one request at a time, at least 1.1 s apart, with a user-agent naming this repository and at most 40 requests per run. GET /api/status shows the counts.

## What it was not allowed to do

No supermarket website is called: their robots.txt disallows the price APIs. No UI. No matching across chains beyond the EAN.

## How anyone would know it worked

- Migration 0001 creates products, prices (source open_prices or demo, observed_on date) and imports.
- The Open Prices reader keeps only Spanish locations of the seven chains, skips items without EAN, EUR price or date, waits 1.1 s between requests, sends the project user-agent and stops at the cap; unit tests prove each.
- Demo prices are stable between runs, within -8% and +12% of a reference price, and every demo product has a price in at least three chains; unit tests prove it.
- After one run in production, /api/status shows demo and Open Prices rows per chain with their newest date.

## Exceptions

- **2026-11-11 UTC** — paulo@commitcycle.com asked for access: write on Database schema — the first migration: products, prices and the import log the daily cron writes (otherwise: none: the app has no tables yet)
- **2026-11-11 UTC** — paulo@commitcycle.com approved: write on Database schema — approved
- **2026-11-12 UTC** — at close, 9 changed file(s) are in no zone: .zones/audit/CC-1.md, .zones/tasks/CC-1.md, .zones/tasks/CC-2.md, src/store.ts, src/index.ts and 4 more. Should any be protected? `cycle protect <glob> --zone <id>` if yes, `cycle dismiss <glob>` to stop being asked.
- **2026-11-12 UTC** — at close, Nothing observed this work: 13 changed file(s) and no mutation events at all (.zones/audit/CC-1.md, .zones/tasks/CC-1.md, .zones/tasks/CC-2.md and 10 more). That is what a hand-edited task looks like — but it is also what a task run with the hook switched off looks like, and from here they are the same.

## Access asked for

| Zone | Mode | Asked by | Decided | By | TTL |
|---|---|---|---|---|---|
| schema | write | paulo@commitcycle.com | approved | paulo@commitcycle.com | — |

**schema** — the first migration: products, prices and the import log the daily cron writes

_If refused:_ none: the app has no tables yet

## What changed

13 file(s) between `2a9787c7` and `9b40fec8`.

- `.zones/audit/CC-1.md` (A)
- `.zones/tasks/CC-1.md` (M)
- `.zones/tasks/CC-2.md` (A)
- `migrations/0001_prices.sql` (A)
- `src/sources/openprices.ts` (A)
- `src/sources/demo-products.ts` (A)
- `src/sources/demo.ts` (A)
- `src/store.ts` (A)
- `src/index.ts` (M)
- `wrangler.jsonc` (M)
- `test/health.test.ts` (M)
- `test/openprices.test.ts` (A)
- `test/demo.test.ts` (A)
