/**
 * The live sources the Worker may call, all through the polite fetch (./http.ts).
 *
 * LIVE_ADAPTERS: one adapter per chain searched live. A chain is only searched live when
 * it has an adapter here AND shared/chains.ts marks it `mode: 'live'`; every other chain
 * answers from the D1 catalogue (Open Prices). Adapters are wired in by the modules that
 * implement them (Alcampo, Aldi, Ahorramas), each documenting its robots.txt rules.
 *
 * OFF: the product catalogue and details provider (Open Food Facts). It needs no key;
 * when a method is absent the routes skip it (search) or answer null (details).
 */
import type { ChainId, Product, ProductDetails } from '../../shared/types';
import type { AdapterCtx, ChainAdapter } from './types';
import { ahorramas } from './ahorramas';
import { alcampo } from './alcampo';
import { aldi } from './aldi';
import { openFoodFacts } from './openfoodfacts';

/** Mercadona and BM are not here: their prices only come from APIs their robots.txt closes to bots (see shared/chains.ts). */
export const LIVE_ADAPTERS: Partial<Record<ChainId, ChainAdapter>> = { alcampo, aldi, ahorramas };

export interface CatalogueProvider {
  search?(query: string, ctx: AdapterCtx): Promise<Product[]>;
  details?(ean: string, ctx: AdapterCtx): Promise<ProductDetails | null>;
}

export const OFF: CatalogueProvider = openFoodFacts;
