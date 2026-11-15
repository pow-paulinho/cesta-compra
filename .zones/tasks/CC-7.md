---
id: CC-7
title: Live supermarket search in the background and a playful web app that builds the best cart and the best multi-store split
state: In Progress
plan_task: —
owner: paulo@commitcycle.com
mode: standard
topics: [frontend, motion-design, scraping-politeness]
branch: claude/gallant-brown-gmdpi8
time_box: null
quality_gate: visual review
priority: high
created: 2026-11-15
---

# CC-7 · Live supermarket search in the background and a playful web app that builds the best cart and the best multi-store split

Record written by hand in the session that does the work: the CommitCycle
connectors available in that session answered for the boards `pow/commitcycle`
and `pow/worktude`, not for `pow/cesta-compra` (`.zones/board.json`), and the
`cycle` binary was not installed. The owner chose, in the session, to register
the task here and move it to the board afterwards.

## Goal

A product search that finds products with photos, and, once a product and its
quantity are chosen, looks for it in Mercadona, Alcampo, Aldi, Ahorramas and BM
in the background, streaming each chain's answer as it arrives. Carrefour,
El Corte Inglés/Supercor and Lidl, whose websites block automated access or
publish no food prices, fall back to Open Prices and say so. A new web app
(Spanish, mobile first, Duolingo-like playfulness with Apple-Store-like product
pages and micro-animations) shows product pages with photos and details, the
cart with each item's hunt progress, and at the end the cheapest single-store
cart and the cheapest split across several stores, with clear saving tips.
Personal use only, not for sale. No authentication in v1; live search answers
only to requests carrying the owner's key (`LIVE_KEY`), locally and deployed.

## Non-goals

No accounts or user authentication. No new tables or migrations (live results
are cached, not stored). No crawling of whole catalogues: one search per chain
per product, cached, at a human pace. No live calls without the owner's key.
No bypassing of anti-bot protection (Carrefour, El Corte Inglés): those chains
fall back. No change to `cycle guard-deploy` or to how deploys are guarded.

## Affected zones

sources (write) — approved by the owner in the session on 2026-11-15, together
with the use of the Mercadona and BM APIs that their robots.txt disallows to
crawlers, for personal use at a human pace.

## Acceptance criteria

- [ ] Searching a product shows product cards with photo, name, size and a price from at least two chains.
- [ ] Choosing a product and a quantity starts a background search whose per-chain results appear one by one without blocking the UI; chains that cannot be searched say why.
- [ ] Without the key, no supermarket is called; with the key, Mercadona, Alcampo, Aldi, Ahorramas and BM answer live (from a machine their sites do not block).
- [ ] The plan shows the cheapest single-store cart and the cheapest split for 1, 2, 3 stores or no limit, the saving, and the items no chain prices; unit tests prove the optimiser.
- [ ] Product pages show photos and details; the app shows saving tips derived from the data.
- [ ] At 390 px and on desktop the app has no horizontal scroll, animations respect reduced motion; npm test and typecheck pass.

---

## History

| When | State | Note |
|---|---|---|
| 2026-11-15 | In Progress | Registered by hand in the session (connectors bound to other boards); sources:write approved by the owner in the session |
