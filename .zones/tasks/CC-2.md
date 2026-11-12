---
id: CC-2
title: Import prices once a day: Open Prices for Spanish supermarkets, politely, plus a seeded and labelled demo price set
state: Done
plan_task: —
owner: paulo@commitcycle.com
mode: standard
topics: []
branch: task/CC-2-import-prices-once-a-day-open-prices-for
time_box: null
quality_gate: regression suite
priority: high
created: 2026-11-11
---

# CC-2 · Import prices once a day: Open Prices for Spanish supermarkets, politely, plus a seeded and labelled demo price set

Record written at birth by `cycle start` (CC-111) — the D-43 orphan pattern
ends where this command begins.

## Goal

A D1 schema (products by EAN, one price per product, chain and source, import log) and a daily cron that seeds about 50 demo products in 5 chains (source demo) and reads Open Prices for Spanish locations of Mercadona, Dia, Consum, Carrefour, Alcampo, Eroski and Lidl, one request at a time, at least 1.1 s apart, with a user-agent naming this repository and at most 40 requests per run. GET /api/status shows the counts.

## Non-goals

No supermarket website is called: their robots.txt disallows the price APIs. No UI. No matching across chains beyond the EAN.

## Affected zones

schema (write), sources (write)

## Acceptance criteria

- [ ] Migration 0001 creates products, prices (source open_prices or demo, observed_on date) and imports.
- [ ] The Open Prices reader keeps only Spanish locations of the seven chains, skips items without EAN, EUR price or date, waits 1.1 s between requests, sends the project user-agent and stops at the cap; unit tests prove each.
- [ ] Demo prices are stable between runs, within -8% and +12% of a reference price, and every demo product has a price in at least three chains; unit tests prove it.
- [ ] After one run in production, /api/status shows demo and Open Prices rows per chain with their newest date.

## Hand-in

### Done
- Migration 0001: products (EAN), prices (one per product, chain and source open_prices|demo, observed_on), imports log.
- Open Prices reader: Spanish locations of 7 chains only, one request at a time 1.1 s apart, project user-agent, cap 40 requests per run; skips items without EAN, EUR price or date.
- Demo set: 50 real EANs/names seen in Open Prices for Spain, 5 chains, stable derived prices labelled demo.
- Daily cron 05:17 UTC; GET /api/status.
### Verification
- npm test 8/8 and tsc clean, locally and from a clean checkout of the branch. CI on the PR.
### Criteria
1. migrations/0001_prices.sql
2. test/openprices.test.ts
3. test/demo.test.ts
4. to be shown after deploy

---

## History

| When | State | Note |
|---|---|---|
| 2026-11-11 | Triage | `cycle start` |
| 2026-11-11 | Todo | Scoped in the same command |
| 2026-11-11 | Todo | **Gate refused In Progress** — see the failures printed at start; branch kept |
| 2026-11-11 | In Progress | Gate passed; grant bound to this branch |
