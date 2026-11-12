---
task: CC-4
title: "Match the same product across chains and answer a product search with every known price, its source and its date"
owner: paulo@commitcycle.com
mode: standard
branch: task/CC-4-match-the-same-product-across-chains-and
quality_gate: regression suite
zones_declared: []
zones_touched: []
declaration_matches: true
exceptions: 2
blocks: 0
mutations_observed: 2
evidence:
  - type: url
    location: https://github.com/pow-paulinho/cesta-compra/actions/runs/43205512964
    by: paulo@commitcycle.com
    at: 2026-11-12 UTC
  - type: url
    location: https://cesta-compra.pow-995.workers.dev/api/products?q=pesto
    by: paulo@commitcycle.com
    at: 2026-11-12 UTC
diff:
  files: 10
  base: ea96a6c3
  head: d16a7273
opened: 2026-11-12 UTC
closed: 2026-11-12 UTC
closed_by: paulo@commitcycle.com
---

# CC-4 — audit record

## What was asked

A matching module (EAN first, padded to 13 digits; otherwise normalised brand, name and size with accents, decimal commas and units folded) and GET /api/products?q= returning up to 30 products whose name, brand or EAN match, each with its prices per chain, source (open_prices or demo), date, stale flag (older than 30 days) and match confidence.

## What it was not allowed to do

No UI. No fuzzy matching beyond normalisation. Demo and real prices are never merged into one price.

## How anyone would know it worked

- EAN-8 and EAN-13 normalise to one key; listings without EAN group by normalised brand, name and size with confidence name; unit tests prove it.
- GET /api/products?q=pesto in production answers products with prices from more than one chain, each price with source, date and stale flag.
- Search escapes LIKE wildcards and answers an empty list for fewer than 2 characters; unit tests prove it.

## Exceptions

- **2026-11-12 UTC** — at close, 10 changed file(s) are in no zone: .zones/audit/CC-2.md, .zones/audit/CC-3.md, .zones/tasks/CC-2.md, .zones/tasks/CC-3.md, .zones/tasks/CC-4.md and 5 more. Should any be protected? `cycle protect <glob> --zone <id>` if yes, `cycle dismiss <glob>` to stop being asked.
- **2026-11-12 UTC** — at close, Nothing observed this work: 10 changed file(s) and no mutation events at all (.zones/audit/CC-2.md, .zones/audit/CC-3.md, .zones/tasks/CC-2.md and 7 more). That is what a hand-edited task looks like — but it is also what a task run with the hook switched off looks like, and from here they are the same.

## What changed

10 file(s) between `ea96a6c3` and `d16a7273`.

- `.zones/audit/CC-2.md` (A)
- `.zones/audit/CC-3.md` (A)
- `.zones/tasks/CC-2.md` (M)
- `.zones/tasks/CC-3.md` (M)
- `.zones/tasks/CC-4.md` (A)
- `src/match.ts` (A)
- `src/api.ts` (A)
- `src/index.ts` (M)
- `test/match.test.ts` (A)
- `test/api.test.ts` (A)
