---
id: CC-6
title: Checkout: split the cart across chains at the lowest total, optionally capped at a number of stores, and show what it saves against the best single store
state: In Progress
plan_task: —
owner: paulo@commitcycle.com
mode: standard
topics: []
branch: task/CC-6-checkout-split-the-cart-across-chains-at
time_box: null
quality_gate: visual review
priority: high
created: 2026-11-12
---

# CC-6 · Checkout: split the cart across chains at the lowest total, optionally capped at a number of stores, and show what it saves against the best single store

Record written at birth by `cycle start` (CC-111) — the D-43 orphan pattern
ends where this command begins.

## Goal

POST /api/checkout takes the cart (EAN and quantity), a store cap (1, 2, 3 or no limit) and a price source (demo or Open Prices, never mixed) and returns, per chain, what to buy there and its subtotal, the total, the items no chain prices, the cheapest single chain that has everything and the saving against it. The page gets a Ver dónde comprar button with both choices and shows that answer.

## Non-goals

No travel distance or store location. No mixing demo and real prices in one plan.

## Affected zones

None (unprotected paths).

## Acceptance criteria

- [ ] The split is exact: with no cap each item goes to its cheapest chain; with a cap it tries every set of chains up to that size and covers as many items as possible before price; unit tests prove it.
- [ ] On the live page a cart of at least 5 demo products shows each chain's list and subtotal, the total and Ahorras X frente a comprarlo todo en Y.
- [ ] With the cap at 1 the page shows one store and no saving; with Open Prices it names the items without a real price.
- [ ] Bad input answers 400 with what is accepted.

---

## History

| When | State | Note |
|---|---|---|
| 2026-11-12 | Triage | `cycle start` |
| 2026-11-12 | Todo | Scoped in the same command |
| 2026-11-12 | In Progress | Gate passed; grant bound to this branch |
