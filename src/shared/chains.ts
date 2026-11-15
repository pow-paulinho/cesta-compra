import type { ChainId, ChainInfo } from './types';

export interface ChainMeta extends ChainInfo {
  /** Brand-neutral colour for chips and dots (not the chain's logo). */
  color: string;
  /** One or two letters for the chip. */
  short: string;
  /** How the chain's name appears in Open Prices / the D1 catalogue. */
  catalogueName: string;
}

/**
 * Which chains are searched live and why the others are not.
 * Mercadona and BM only publish prices through APIs their robots.txt closes to
 * crawlers; using them was approved by the owner but not granted in the session
 * that built v1, so they stay on Open Prices until that is settled.
 */
export const CHAINS: Record<ChainId, ChainMeta> = {
  mercadona: { id: 'mercadona', name: 'Mercadona', short: 'Me', color: '#2E9E5B', catalogueName: 'Mercadona', mode: 'fallback',
    reason: 'Sus precios solo salen por una API vetada a bots en su robots.txt: de momento usamos Open Prices.' },
  carrefour: { id: 'carrefour', name: 'Carrefour', short: 'Ca', color: '#1E5BC6', catalogueName: 'Carrefour', mode: 'fallback',
    reason: 'Carrefour bloquea las búsquedas automáticas (Cloudflare): usamos Open Prices.' },
  alcampo: { id: 'alcampo', name: 'Alcampo', short: 'Al', color: '#E2231A', catalogueName: 'Alcampo', mode: 'live' },
  aldi: { id: 'aldi', name: 'Aldi', short: 'Ad', color: '#00A0E3', catalogueName: 'Aldi', mode: 'live' },
  lidl: { id: 'lidl', name: 'Lidl', short: 'Li', color: '#F2C200', catalogueName: 'Lidl', mode: 'fallback',
    reason: 'Lidl no publica precios de alimentación en su web: usamos Open Prices.' },
  ahorramas: { id: 'ahorramas', name: 'Ahorramas', short: 'Ah', color: '#E8711C', catalogueName: 'Ahorramas', mode: 'live' },
  supercor: { id: 'supercor', name: 'Supercor', short: 'Su', color: '#0B7A3E', catalogueName: 'El Corte Inglés', mode: 'fallback',
    reason: 'El Corte Inglés bloquea las búsquedas automáticas (Akamai): usamos Open Prices.' },
  bm: { id: 'bm', name: 'BM', short: 'BM', color: '#7A3FB0', catalogueName: 'BM', mode: 'fallback',
    reason: 'Sus precios solo salen por una API vetada a bots en su robots.txt: de momento usamos Open Prices.' },
};

export const chainList = (): ChainMeta[] => Object.values(CHAINS);
