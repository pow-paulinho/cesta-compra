/**
 * Products seen in search results, by key, so the product sheet can open from
 * a URL (#/buscar?p=<key>). Kept for the session in sessionStorage.
 *
 * It is a small external store: search results stream in source by source, and
 * an open product sheet subscribes (useProduct) so offers that arrive after it
 * opened still show up. No DOM globals here, so tests can run it in Node.
 */
import { useSyncExternalStore } from 'react';
import type { Offer, Product, ProductDetails } from '@shared/types';
import { detailsUrl } from './api';

const KEY = 'cesta.v2.products';
const MAX = 120;
const cache = new Map<string, Product>();
const listeners = new Set<() => void>();

interface SessionStore {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function session(): SessionStore | null {
  try {
    return (globalThis as { sessionStorage?: SessionStore }).sessionStorage ?? null;
  } catch {
    return null; // access can throw when site data is blocked
  }
}

try {
  const raw = session()?.getItem(KEY);
  if (raw) for (const p of JSON.parse(raw) as Product[]) cache.set(p.key, p);
} catch {
  /* sessionStorage unavailable or corrupt */
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function save() {
  saveTimer = null;
  try {
    session()?.setItem(KEY, JSON.stringify([...cache.values()].slice(-MAX)));
  } catch {
    /* full or blocked */
  }
}

const offerKey = (o: Offer) => `${o.chain}|${o.id}|${o.source}`;

/** Details from both sides; the first side wins per field. Same object back when nothing is new. */
function mergeDetails(a: ProductDetails | undefined, b: ProductDetails | undefined): ProductDetails | undefined {
  if (!a || !b) return a ?? b;
  const adds = (Object.keys(b) as Array<keyof ProductDetails>).some((k) => a[k] === undefined && b[k] !== undefined);
  return adds ? { ...b, ...a } : a;
}

/**
 * Joins two sightings of the same product: offers added (no duplicates), gaps filled
 * (brand, size, ean, image, details). Returns `a` itself when `b` adds nothing, so
 * subscribers are not woken up for nothing.
 */
export function mergeProduct(a: Product, b: Product): Product {
  const seen = new Set(a.offers.map(offerKey));
  const newOffers = b.offers.filter((o) => !seen.has(offerKey(o)));
  const details = mergeDetails(a.details, b.details);
  const merged: Product = {
    ...a,
    brand: a.brand ?? b.brand,
    sizeText: a.sizeText ?? b.sizeText,
    ean: a.ean ?? b.ean,
    image: a.image ?? b.image,
    offers: newOffers.length ? [...a.offers, ...newOffers] : a.offers,
    ...(details ? { details } : {}),
  };
  const same =
    merged.brand === a.brand &&
    merged.sizeText === a.sizeText &&
    merged.ean === a.ean &&
    merged.image === a.image &&
    merged.offers === a.offers &&
    merged.details === a.details;
  return same ? a : merged;
}

/** Merges a product into a list by key (used while a search streams in). */
export function mergeInto(list: Product[], p: Product): Product[] {
  const idx = list.findIndex((x) => x.key === p.key);
  if (idx < 0) return [...list, p];
  const merged = mergeProduct(list[idx]!, p);
  if (merged === list[idx]) return list;
  const out = list.slice();
  out[idx] = merged;
  return out;
}

export function rememberProducts(list: Product[]) {
  let changed = false;
  for (const p of list) {
    const prev = cache.get(p.key);
    const next = prev ? mergeProduct(prev, p) : p;
    if (next !== prev) {
      cache.set(p.key, next);
      changed = true;
    }
  }
  if (!changed) return;
  while (cache.size > MAX) cache.delete(cache.keys().next().value!);
  if (!saveTimer) saveTimer = setTimeout(save, 300);
  listeners.forEach((l) => l());
}

export function findProduct(key: string): Product | null {
  return cache.get(key) ?? null;
}

export function subscribeProducts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The product as it is known now; re-renders when later search results add offers or details. */
export function useProduct(key: string): Product | null {
  return useSyncExternalStore(
    subscribeProducts,
    () => findProduct(key),
    () => findProduct(key),
  );
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
