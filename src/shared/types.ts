/**
 * Types shared by the Worker and the web app. Pure: no runtime imports.
 */
export const CHAIN_IDS = ['mercadona', 'carrefour', 'alcampo', 'aldi', 'lidl', 'ahorramas', 'supercor', 'bm'] as const;
export type ChainId = (typeof CHAIN_IDS)[number];

export type OfferSource = 'live' | 'open_prices' | 'demo';
export type PriceUnit = 'kg' | 'l' | 'ud';

/** One sellable unit (a pack, a bottle, a kilo) of a product at one chain. */
export interface Offer {
  chain: ChainId;
  /** The chain's product id, or the EAN for prices from the catalogue. */
  id: string;
  name: string;
  brand: string | null;
  ean: string | null;
  /** As the chain shows it: "1 L", "6 x 1 L", "500 g". */
  sizeText: string | null;
  /** Price of one sellable unit, in cents. */
  priceCents: number;
  /** Price per kg, l or unit, as published or computed. */
  unitPriceCents: number | null;
  unit: PriceUnit | null;
  image: string | null;
  url: string | null;
  /** "Oferta hasta 21/11", "2ª unidad -50 %". */
  promo: string | null;
  source: OfferSource;
  /** YYYY-MM-DD. */
  observedOn: string;
  cached?: boolean;
}

export type ChainStatus = 'ok' | 'none' | 'locked' | 'blocked' | 'unavailable' | 'error';

export interface ProductDetails {
  nutriscore?: string | null;
  nova?: number | null;
  ingredients?: string | null;
  allergens?: string[];
  categories?: string[];
  quantity?: string | null;
  images?: string[];
}

/** A card in the search results, merged across sources. */
export interface Product {
  /** ean:<13 digits> or name:<normalised words>. */
  key: string;
  name: string;
  brand: string | null;
  sizeText: string | null;
  ean: string | null;
  image: string | null;
  offers: Offer[];
  details?: ProductDetails;
}

export type SearchSource = ChainId | 'openfoodfacts' | 'catalogo';

export type SearchEvent =
  | { type: 'source'; source: SearchSource; status: ChainStatus; products: Product[]; reason?: string; ms: number }
  | { type: 'done'; ms: number };

export type HuntMode = 'exact' | 'equivalent';

export interface WantedProduct {
  name: string;
  brand: string | null;
  sizeText: string | null;
  ean: string | null;
}

export interface HuntRequest {
  product: WantedProduct;
  mode: HuntMode;
  chains?: ChainId[];
}

export type MatchKind = 'exact' | 'same-brand' | 'equivalent' | 'weak';

export interface Candidate extends Offer {
  score: number;
  kind: MatchKind;
}

export type HuntEvent =
  | { type: 'chain'; chain: ChainId; status: ChainStatus; candidates: Candidate[]; pick: Candidate | null; reason?: string; ms: number }
  | { type: 'done'; ms: number };

export interface ChainInfo {
  id: ChainId;
  name: string;
  mode: 'live' | 'fallback';
  reason?: string;
}

export interface LiveStatus {
  live: boolean;
  chains: ChainInfo[];
}
