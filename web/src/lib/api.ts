/**
 * How the web app talks to the Worker (src/live/*): URLs, the live-key header and the hunt
 * body. Kept pure (no DOM, no app state) so test/web-contract.test.ts can run them against
 * the Worker's own handlers.
 */
import type { ChainId, HuntMode, HuntRequest, WantedProduct } from '@shared/types';

/** The header the Worker reads the owner's live key from (src/live/auth.ts). */
export const LIVE_KEY_HEADER = 'x-live-key';

/** The live-key header when there is a key; no header otherwise. */
export function liveHeaders(key: string | null | undefined): Record<string, string> {
  const k = (key ?? '').trim();
  return k ? { [LIVE_KEY_HEADER]: k } : {};
}

/** GET /api/search; demo mode reads the catalogue's demo prices instead of Open Prices. */
export function searchUrl(q: string, demo: boolean): string {
  return `/api/search?q=${encodeURIComponent(q)}${demo ? '&demo=1' : ''}`;
}

/** What /api/details accepts as an EAN: 8 to 14 digits. */
export const isEan = (s: string | null | undefined): s is string => typeof s === 'string' && /^\d{8,14}$/.test(s);

/** GET /api/details. */
export const detailsUrl = (ean: string): string => `/api/details?ean=${encodeURIComponent(ean)}`;

/** Collapses spaces and cuts a text to a length the Worker accepts; empty becomes null. */
const fit = (v: string | null | undefined, max: number): string | null => {
  const t = (v ?? '').replace(/\s+/g, ' ').trim().slice(0, max).trim();
  return t || null;
};

export interface HuntItem {
  product: WantedProduct;
  mode: HuntMode;
  qty: number;
}

/**
 * The POST /api/hunt body for a cart item, within what the Worker accepts (name 2-120
 * characters, brand up to 80, size up to 40, EAN 8-14 digits or null, qty 1-99): names
 * and brands from Open Food Facts can run longer, and their codes are not always EANs.
 */
export function huntBody(item: HuntItem, settings: { chains: ChainId[]; demo: boolean }): HuntRequest {
  const ean = (item.product.ean ?? '').trim();
  return {
    product: {
      name: fit(item.product.name, 120) ?? item.product.name,
      brand: fit(item.product.brand, 80),
      sizeText: fit(item.product.sizeText, 40),
      ean: isEan(ean) ? ean : null,
    },
    mode: item.mode,
    chains: [...settings.chains],
    qty: Math.max(1, Math.min(99, Math.round(item.qty) || 1)),
    ...(settings.demo ? { demo: true } : {}),
  };
}
