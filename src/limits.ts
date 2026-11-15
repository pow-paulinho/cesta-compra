/**
 * Limits the Worker's routes and its daily import share.
 *
 * They live here, not in src/index.ts: the Worker's main module may only export functions
 * and handlers (workerd refuses to start with "Incorrect type for map entry …" otherwise).
 */

/** Largest body /api/checkout reads (60 items of {ean, qty} take about 2 KB). */
export const CHECKOUT_MAX_BYTES = 8 * 1024;

/** How long one Open Prices request may take, body included, before the import moves on. */
export const IMPORT_REQUEST_TIMEOUT_MS = 15_000;
