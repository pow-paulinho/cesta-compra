---
task: CC-5
title: "A web page to search products and build a cart, with each price's source and date in view"
owner: paulo@commitcycle.com
mode: standard
branch: task/CC-5-a-web-page-to-search-products-and-build-
quality_gate: visual review
zones_declared: []
zones_touched: []
declaration_matches: true
exceptions: 2
blocks: 0
mutations_observed: 2
evidence:
  - type: url
    location: https://github.com/pow-paulinho/cesta-compra/pull/5#issuecomment-6821884672
    by: paulo@commitcycle.com
    at: 2026-11-12 UTC
  - type: url
    location: https://github.com/user-attachments/assets/2a2d5ccc-ff29-4c9a-abae-573e64979cdb
    by: paulo@commitcycle.com
    at: 2026-11-12 UTC
  - type: url
    location: https://github.com/user-attachments/assets/b90e61d2-76a0-4f3c-9c4f-ac5dadce29df
    by: paulo@commitcycle.com
    at: 2026-11-12 UTC
  - type: url
    location: https://github.com/user-attachments/assets/3fd4d5e9-25bd-49a9-8182-c257c2e56f51
    by: paulo@commitcycle.com
    at: 2026-11-12 UTC
diff:
  files: 6
  base: aa318eac
  head: 3081ef5e
opened: 2026-11-12 UTC
closed: 2026-11-12 UTC
closed_by: paulo@commitcycle.com
---

# CC-5 — audit record

## What was asked

GET / serves one page (Spanish, no build step): a search box that lists matching products with every chain's price, a demo tag on demo prices and an Open Prices tag with the date on real ones, an old tag when a real price is over 30 days, and an Add button; a cart kept in localStorage with quantities that can be raised, lowered and removed.

## What it was not allowed to do

No checkout or split yet. No accounts. No server-side cart.

## How anyone would know it worked

- Searching pesto on the live page shows Barilla, Gallo and Garofalo pesto with prices from several chains, demo prices tagged demo and real ones tagged Open Prices with their date and old when stale.
- Add puts a product in the cart; + and − change its quantity and − at 1 removes it; the cart survives a reload.
- At 390 px wide the page has no horizontal scroll and the cart sits under the search.

## Exceptions

- **2026-11-12 UTC** — at close, 6 changed file(s) are in no zone: .zones/audit/CC-4.md, .zones/tasks/CC-4.md, .zones/tasks/CC-5.md, src/ui.ts, src/index.ts and 1 more. Should any be protected? `cycle protect <glob> --zone <id>` if yes, `cycle dismiss <glob>` to stop being asked.
- **2026-11-12 UTC** — at close, Nothing observed this work: 6 changed file(s) and no mutation events at all (.zones/audit/CC-4.md, .zones/tasks/CC-4.md, .zones/tasks/CC-5.md and 3 more). That is what a hand-edited task looks like — but it is also what a task run with the hook switched off looks like, and from here they are the same.

## What changed

6 file(s) between `aa318eac` and `3081ef5e`.

- `.zones/audit/CC-4.md` (A)
- `.zones/tasks/CC-4.md` (M)
- `.zones/tasks/CC-5.md` (A)
- `src/ui.ts` (A)
- `src/index.ts` (M)
- `test/ui.test.ts` (A)
