---
id: CC-4
title: Match the same product across chains and answer a product search with every known price, its source and its date
state: Done
plan_task: —
owner: paulo@commitcycle.com
mode: standard
topics: []
branch: task/CC-4-match-the-same-product-across-chains-and
time_box: null
quality_gate: regression suite
priority: high
created: 2026-11-12
---

# CC-4 · Match the same product across chains and answer a product search with every known price, its source and its date

Record written at birth by `cycle start` (CC-111) — the D-43 orphan pattern
ends where this command begins.

## Goal

A matching module (EAN first, padded to 13 digits; otherwise normalised brand, name and size with accents, decimal commas and units folded) and GET /api/products?q= returning up to 30 products whose name, brand or EAN match, each with its prices per chain, source (open_prices or demo), date, stale flag (older than 30 days) and match confidence.

## Non-goals

No UI. No fuzzy matching beyond normalisation. Demo and real prices are never merged into one price.

## Affected zones

None (unprotected paths).

## Acceptance criteria

- [ ] EAN-8 and EAN-13 normalise to one key; listings without EAN group by normalised brand, name and size with confidence name; unit tests prove it.
- [ ] GET /api/products?q=pesto in production answers products with prices from more than one chain, each price with source, date and stale flag.
- [ ] Search escapes LIKE wildcards and answers an empty list for fewer than 2 characters; unit tests prove it.

## Hand-in

### Done
- src/match.ts: EAN key padded to 13 digits; otherwise normalised brand+name+size (accents, decimal commas, kg/l/cl folded), confidence ean|name.
- GET /api/products?q=: up to 30 products, each price with chain, source, cents, date, place, stale (>30 days), plus match confidence. LIKE wildcards escaped; <2 chars answers [] without a query.
### Verification
- 15/15 tests (match, api, previous), tsc clean. Production check after deploy.
### Criteria
1. test/match.test.ts
2. after deploy
3. test/api.test.ts

---

## History

| When | State | Note |
|---|---|---|
| 2026-11-12 | Triage | `cycle start` |
| 2026-11-12 | Todo | Scoped in the same command |
| 2026-11-12 | In Progress | Gate passed; grant bound to this branch |
