# cesta-compra

Build a shopping cart and see which Spanish supermarkets to visit for each part of it, and what you save.

A test project for [CommitCycle](https://www.commitcycle.com): every change here goes through a CommitCycle task.

## Prices

- **Open Prices** ([prices.openfoodfacts.org](https://prices.openfoodfacts.org)): open, crowdsourced prices from Spanish stores, imported once a day. Each price shows its date; prices older than 30 days are marked stale.
- **Demo**: a seeded set of common products with realistic prices, labelled "demo" everywhere. They are not real quotes.

Supermarket websites are not scraped: their `robots.txt` disallows the price APIs, and their allowed pages render prices in the browser only.

## Stack

Cloudflare Worker + D1. `npm test` runs vitest, `npm run typecheck` runs tsc.
