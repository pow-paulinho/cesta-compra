/**
 * Products seen in search results, by key, so the product sheet can open from
 * a URL (#/buscar?p=<key>). Kept for the session in sessionStorage.
 */
import type { Product, ProductDetails } from '@shared/types';
import { detailsUrl } from './api';
import { getState } from './store';

const KEY = 'cesta.v2.products';
const MAX = 120;
const cache = new Map<string, Product>();

try {
  const raw = sessionStorage.getItem(KEY);
  if (raw) for (const p of JSON.parse(raw) as Product[]) cache.set(p.key, p);
} catch {
  /* sessionStorage unavailable */
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function save() {
  saveTimer = null;
  try {
    sessionStorage.setItem(KEY, JSON.stringify([...cache.values()].slice(-MAX)));
  } catch {
    /* full or blocked */
  }
}

export function rememberProducts(list: Product[]) {
  for (const p of list) {
    const prev = cache.get(p.key);
    if (!prev) {
      cache.set(p.key, p);
      continue;
    }
    const seen = new Set(prev.offers.map((o) => `${o.chain}|${o.id}|${o.source}`));
    cache.set(p.key, {
      ...prev,
      image: prev.image ?? p.image,
      brand: prev.brand ?? p.brand,
      sizeText: prev.sizeText ?? p.sizeText,
      offers: [...prev.offers, ...p.offers.filter((o) => !seen.has(`${o.chain}|${o.id}|${o.source}`))],
    });
  }
  while (cache.size > MAX) cache.delete(cache.keys().next().value!);
  if (!saveTimer) saveTimer = setTimeout(save, 300);
}

export function findProduct(key: string): Product | null {
  const p = cache.get(key);
  if (p) return p;
  const inCart = getState().cart.find((i) => i.product.key === key);
  return inCart ? { ...inCart.product } : null;
}

// ---------------------------------------------------------------------------
// Details (/api/details?ean=)
// ---------------------------------------------------------------------------

const details = new Map<string, Promise<ProductDetails | null>>();

export function loadDetails(ean: string): Promise<ProductDetails | null> {
  let p = details.get(ean);
  if (!p) {
    p = fetch(detailsUrl(ean))
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { details: ProductDetails | null };
        return body.details ?? null;
      })
      .catch((e) => {
        details.delete(ean);
        throw e;
      });
    details.set(ean, p);
  }
  return p;
}
