---
id: CC-5
title: A web page to search products and build a cart, with each price's source and date in view
state: Done
plan_task: —
owner: paulo@commitcycle.com
mode: standard
topics: []
branch: task/CC-5-a-web-page-to-search-products-and-build-
time_box: null
quality_gate: visual review
priority: high
created: 2026-11-12
---

# CC-5 · A web page to search products and build a cart, with each price's source and date in view

Record written at birth by `cycle start` (CC-111) — the D-43 orphan pattern
ends where this command begins.

## Goal

GET / serves one page (Spanish, no build step): a search box that lists matching products with every chain's price, a demo tag on demo prices and an Open Prices tag with the date on real ones, an old tag when a real price is over 30 days, and an Add button; a cart kept in localStorage with quantities that can be raised, lowered and removed.

## Non-goals

No checkout or split yet. No accounts. No server-side cart.

## Affected zones

None (unprotected paths).

## Acceptance criteria

- [ ] Searching pesto on the live page shows Barilla, Gallo and Garofalo pesto with prices from several chains, demo prices tagged demo and real ones tagged Open Prices with their date and old when stale.
- [ ] Add puts a product in the cart; + and − change its quantity and − at 1 removes it; the cart survives a reload.
- [ ] At 390 px wide the page has no horizontal scroll and the cart sits under the search.

## Hand-in

### Done
- GET / serves the page: search with every chain's price, demo / Open Prices + date / antiguo tags, Add; cart in localStorage with + and −.
### Verification
- 19/19 tests incl. test/ui.test.ts (served at /, tags present, script parses, 404). Visual proof in production after deploy.
### Criteria
1-3. visual review in production

---

## History

| When | State | Note |
|---|---|---|
| 2026-11-12 | Triage | `cycle start` |
| 2026-11-12 | Todo | Scoped in the same command |
| 2026-11-12 | In Progress | Gate passed; grant bound to this branch |
