/**
 * Sample Spanish supermarket products for the mock API (development and visual QA only).
 * Prices are plausible but invented; brands are real product brands, chains get no logos.
 */
import { CHAIN_IDS, type ChainId, type Offer, type ProductDetails } from '../../src/shared/types';
import { CHAINS } from '../../src/shared/chains';
import { offerSize, OWN_BRANDS } from '../../src/shared/equiv';
import { unitPriceCents } from '../../src/shared/units';
import { productImage, type Art, type Shape } from './images';

export interface MockProduct {
  ean: string;
  name: string;
  brand: string;
  sizeText: string;
  image: string;
  /** Typical price in cents at an average chain. */
  base: number;
  /** Chains that sell it. */
  chains: ChainId[];
  details: ProductDetails;
}

/** FNV-1a, 32 bits. */
function hash32(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic pseudo-random number in [0, 1). */
export function rand(seed: string): number {
  return (hash32(seed) % 10000) / 10000;
}

function ean13(seed: string): string {
  const digits = ('84' + String(hash32(seed)).padStart(10, '0')).slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (i % 2 ? 3 : 1);
  return digits + ((10 - (sum % 10)) % 10);
}

const PRICE_LEVEL: Record<ChainId, number> = {
  aldi: 0.9, lidl: 0.92, mercadona: 0.95, alcampo: 0.97, ahorramas: 1.0, carrefour: 1.02, bm: 1.06, supercor: 1.2,
};

function ownChain(brand: string): ChainId | null {
  for (const c of CHAIN_IDS) if (OWN_BRANDS[c].some((b) => b.toLowerCase() === brand.toLowerCase())) return c;
  return null;
}

interface FamilyDef {
  noun: string; // generic product name, e.g. "Leche semidesnatada"
  sizeText: string;
  shape: Shape;
  color: string;
  accent: string;
  label: string;
  details: ProductDetails;
  /** [brand, base price in cents, name suffix?] */
  brands: Array<[string, number, string?]>;
}

const NUTRI = (n: string, nova: number, ingredients: string, allergens: string[]): ProductDetails => ({
  nutriscore: n, nova, ingredients, allergens,
});

const FAMILIES: FamilyDef[] = [
  {
    noun: 'Leche semidesnatada', sizeText: '1 L', shape: 'carton', color: '#1CB0F6', accent: '#1899D6', label: 'LECHE',
    details: NUTRI('b', 1, 'Leche de vaca semidesnatada, corrector de acidez (citrato de sodio), vitaminas A y D.', ['leche']),
    brands: [['Pascual', 125], ['Central Lechera Asturiana', 119], ['Puleva', 122], ['Hacendado', 95], ['Carrefour', 92], ['Auchan', 90], ['Milsani', 86], ['Milbona', 87], ['Alipende', 91]],
  },
  {
    noun: 'Leche semidesnatada', sizeText: '6 x 1 L', shape: 'brick6', color: '#1CB0F6', accent: '#1899D6', label: 'PACK 6',
    details: NUTRI('b', 1, 'Leche de vaca semidesnatada, vitaminas A y D.', ['leche']),
    brands: [['Central Lechera Asturiana', 699], ['Hacendado', 552], ['Milsani', 504]],
  },
  {
    noun: 'Leche entera', sizeText: '1 L', shape: 'carton', color: '#CE82FF', accent: '#A568CC', label: 'ENTERA',
    details: NUTRI('c', 1, 'Leche de vaca entera.', ['leche']),
    brands: [['Pascual', 132], ['Hacendado', 99], ['Milbona', 95]],
  },
  {
    noun: 'Leche sin lactosa semidesnatada', sizeText: '1 L', shape: 'carton', color: '#FF9600', accent: '#E07F00', label: '0% LACT',
    details: NUTRI('b', 2, 'Leche semidesnatada, enzima lactasa.', ['leche']),
    brands: [['Puleva', 145], ['Hacendado', 109], ['Carrefour', 112]],
  },
  {
    noun: 'Aceite de oliva virgen extra', sizeText: '1 L', shape: 'bottle', color: '#7FB800', accent: '#3F6E00', label: 'AOVE',
    details: NUTRI('b', 2, 'Aceite de oliva virgen extra.', []),
    brands: [['Carbonell', 899], ['La Española', 879], ['Hacendado', 749], ['Carrefour', 769], ['Auchan', 745], ['Rio d\'Oro', 719]],
  },
  {
    noun: 'Aceite de girasol', sizeText: '1 L', shape: 'bottle', color: '#FFC800', accent: '#B98F00', label: 'GIRASOL',
    details: NUTRI('c', 2, 'Aceite refinado de girasol.', []),
    brands: [['Koipesol', 249], ['Hacendado', 179], ['Carrefour', 185]],
  },
  {
    noun: 'Huevos frescos L', sizeText: '12 ud', shape: 'eggs', color: '#B9805A', accent: '#F4E3CF', label: 'DOCENA',
    details: NUTRI('a', 1, 'Huevos frescos de gallina, categoría A, talla L.', ['huevo']),
    brands: [['Pazo de Vilane', 399], ['Hacendado', 275], ['Carrefour', 279], ['Alcampo', 269]],
  },
  {
    noun: 'Huevos frescos M', sizeText: '6 ud', shape: 'eggs', color: '#C8956B', accent: '#FBEBD8', label: '6 HUEVOS',
    details: NUTRI('a', 1, 'Huevos frescos de gallina, talla M.', ['huevo']),
    brands: [['Hacendado', 149], ['Milsani', 139]],
  },
  {
    noun: 'Café molido natural', sizeText: '250 g', shape: 'bag', color: '#6B3E26', accent: '#C27C4E', label: 'CAFÉ',
    details: NUTRI('a', 1, 'Café tostado natural molido, 100 % arábica.', []),
    brands: [['Marcilla', 379], ['Saimaza', 365], ['Hacendado', 255], ['Bellarom', 249]],
  },
  {
    noun: 'Yogur natural', sizeText: '4 x 125 g', shape: 'cups', color: '#F2F2F2', accent: '#1CB0F6', label: 'NATURAL',
    details: NUTRI('a', 1, 'Leche pasteurizada, leche en polvo desnatada, fermentos lácticos.', ['leche']),
    brands: [['Danone', 219], ['Pastoret', 199], ['Hacendado', 109], ['Milbona', 99]],
  },
  {
    noun: 'Pan de molde blanco', sizeText: '460 g', shape: 'loaf', color: '#E9A23B', accent: '#F7D9A6', label: 'MOLDE',
    details: NUTRI('b', 4, 'Harina de trigo, agua, azúcar, levadura, aceite de girasol, sal.', ['gluten', 'soja']),
    brands: [['Bimbo', 229], ['Hacendado', 125], ['Carrefour', 129], ['Alipende', 119]],
  },
  {
    noun: 'Tomate triturado natural', sizeText: '400 g', shape: 'can', color: '#FF4B4B', accent: '#B92828', label: 'TOMATE',
    details: NUTRI('a', 1, 'Tomate, corrector de acidez (ácido cítrico).', []),
    brands: [['Orlando', 109], ['Solís', 99], ['Hacendado', 69], ['Auchan', 65], ['BM', 72]],
  },
  {
    noun: 'Atún claro en aceite de oliva', sizeText: '3 x 80 g', shape: 'can', color: '#2B70C9', accent: '#FFC800', label: 'ATÚN',
    details: NUTRI('b', 3, 'Atún claro (Thunnus albacares), aceite de oliva, sal.', ['pescado']),
    brands: [['Calvo', 499], ['Isabel', 449], ['Hacendado', 329], ['Carrefour', 339], ['Supercor', 389]],
  },
  {
    noun: 'Arroz redondo', sizeText: '1 kg', shape: 'bag', color: '#F4F1E8', accent: '#E07F00', label: 'ARROZ',
    details: NUTRI('a', 1, 'Arroz redondo.', []),
    brands: [['SOS', 199], ['La Fallera', 185], ['Brillante', 209], ['Hacendado', 129], ['Auchan', 125]],
  },
  {
    noun: 'Galletas María', sizeText: '800 g', shape: 'box', color: '#FFC800', accent: '#E07F00', label: 'MARÍA',
    details: NUTRI('d', 4, 'Harina de trigo, azúcar, aceite de girasol, jarabe de glucosa, gasificantes, sal.', ['gluten', 'leche']),
    brands: [['Fontaneda', 279], ['Gullón', 239], ['Cuétara', 249], ['Hacendado', 159], ['Choceur', 155]],
  },
];

function buildCatalogue(): MockProduct[] {
  const out: MockProduct[] = [];
  for (const f of FAMILIES) {
    for (const [brand, base, suffix] of f.brands) {
      const own = ownChain(brand);
      const name = `${f.noun}${suffix ? ` ${suffix}` : ''} ${brand}`.replace(/\s+/g, ' ');
      const seed = `${name}|${f.sizeText}`;
      const chains = own
        ? [own]
        : CHAIN_IDS.filter((c) => c !== 'lidl' && c !== 'aldi' ? rand(`${seed}|${c}`) > 0.18 : rand(`${seed}|${c}`) > 0.75);
      const art: Art = { shape: f.shape, color: f.color, accent: f.accent, label: f.label };
      // Own brands get a slightly different colour so cards are not identical.
      if (own) art.color = shade(f.color, rand(seed) * 0.25 - 0.12);
      out.push({ ean: ean13(seed), name, brand, sizeText: f.sizeText, image: productImage(art), base, chains, details: { ...f.details, quantity: f.sizeText } });
    }
  }
  return out;
}

function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + (amt > 0 ? (255 - v) * amt : v * amt))));
  const r = ch(n >> 16), g = ch((n >> 8) & 255), b = ch(n & 255);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

export const CATALOGUE: MockProduct[] = buildCatalogue();

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** The offer of a product at a chain, or null when the chain does not sell it. */
export function offerAt(p: MockProduct, chain: ChainId, source: Offer['source'], now = new Date()): Offer | null {
  if (!p.chains.includes(chain)) return null;
  const noise = 0.94 + rand(`${p.ean}|${chain}|price`) * 0.12;
  const priceCents = Math.max(19, Math.round((p.base * PRICE_LEVEL[chain] * noise) / 1) - (rand(p.ean + chain) > 0.5 ? 1 : 0));
  // Open Prices data is days or months old; live and demo are today.
  const age = source === 'open_prices' ? Math.floor(rand(`${p.ean}|${chain}|age`) * 70) : 0;
  const observed = new Date(now.getTime() - age * 86_400_000);
  const unit = unitPriceCents(priceCents, offerSize({ sizeText: p.sizeText, name: p.name }));
  const promoRoll = rand(`${p.ean}|${chain}|promo`);
  const promo = promoRoll > 0.9 ? '2ª unidad -50 %' : promoRoll > 0.84 ? `Oferta hasta ${String(now.getDate() + 3).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}` : null;
  return {
    chain,
    id: source === 'live' ? `${chain}-${p.ean.slice(-6)}` : p.ean,
    name: p.name,
    brand: p.brand,
    ean: p.ean,
    sizeText: p.sizeText,
    priceCents,
    unitPriceCents: unit?.cents ?? null,
    unit: unit?.unit ?? null,
    image: p.image,
    url: null,
    promo,
    source,
    observedOn: iso(observed),
  };
}

/** Whether a chain has Open Prices data for a product (fallback chains). */
export function hasOpenPrices(p: MockProduct, chain: ChainId): boolean {
  return rand(`${p.ean}|${chain}|op`) > 0.3;
}

export const isLiveChain = (c: ChainId) => CHAINS[c].mode === 'live';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Products whose name or brand contains every query word (prefix match). */
export function searchCatalogue(q: string): MockProduct[] {
  const words = norm(q).split(/[^a-z0-9]+/).filter((w) => w.length > 1);
  if (!words.length) return [];
  return CATALOGUE.filter((p) => {
    const hay = norm(`${p.name} ${p.brand}`).split(/[^a-z0-9]+/);
    return words.every((w) => hay.some((h) => h.startsWith(w) || (w.length > 3 && h.startsWith(w.replace(/s$/, '')))));
  });
}
