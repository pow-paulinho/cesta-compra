import { forwardRef } from 'react';
import { motion } from 'motion/react';
import type { Offer, Product } from '@shared/types';
import { CHAINS } from '@shared/chains';
import { formatEuros } from '@shared/units';
import { ChainTags, ProductImg } from './ui';
import { chainsByPrice, priceRange } from './ui-logic';
import { joinNames, nameWithoutBrand, unitPriceLabel } from '../lib/format';
import { DUR, EASE_OUT, stagger } from '../lib/motion';

export function cheapest(offers: Offer[]): Offer | null {
  let best: Offer | null = null;
  for (const o of offers) if (o.priceCents > 0 && (!best || o.priceCents < best.priceCents)) best = o;
  return best;
}

/** "1,13 €" or, when the chains disagree, "1,13–1,51 €". */
function rangeText(r: { min: number; max: number }): string {
  if (r.min === r.max) return formatEuros(r.min);
  return `${formatEuros(r.min).replace(/\s*€$/, '')}–${formatEuros(r.max)}`;
}

export const ProductCard = forwardRef<HTMLLIElement, { product: Product; index: number; onOpen: (p: Product) => void }>(function ProductCard({ product: p, index, onOpen }, ref) {
  const best = cheapest(p.offers);
  const unit = best ? unitPriceLabel(best) : null;
  const range = priceRange(p.offers.map((o) => o.priceCents));
  const chains = chainsByPrice(p.offers);
  const brand = p.brand?.trim() || null;
  const name = brand ? nameWithoutBrand(p.name, brand) : p.name;
  const chainNames = joinNames(chains.map((c) => CHAINS[c]?.name ?? c));
  const priceSaid = range ? (range.min === range.max ? formatEuros(range.min) : `de ${formatEuros(range.min)} a ${formatEuros(range.max)}`) : 'sin precio todavía';
  const label = [brand, name, p.sizeText, priceSaid, chainNames && `en ${chainNames}`].filter(Boolean).join(', ');
  return (
    <motion.li
      ref={ref}
      layout="position"
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: DUR.slow, ease: EASE_OUT, delay: stagger(index) }}
      style={{ listStyle: 'none' }}
    >
      <button type="button" className="pcard" onClick={() => onOpen(p)} aria-label={label}>
        <span className="pimg">
          <ProductImg src={p.image} alt="" />
        </span>
        {brand && <span className="pbrand">{brand}</span>}
        <span className={brand ? 'name' : 'name solo'}>{name}</span>
        {p.sizeText && <span className="meta">{p.sizeText}</span>}
        <span className="foot">
          <ChainTags chains={chains} />
          {range ? (
            <span className="price-line">
              <span className={range.min === range.max ? 'price' : 'price range'}>{rangeText(range)}</span>
              {unit && <span className="unit">{range.min === range.max ? unit : `desde ${unit}`}</span>}
            </span>
          ) : (
            <span className="unit">Sin precio aún: añádelo y lo buscamos</span>
          )}
        </span>
      </button>
    </motion.li>
  );
});

export function SkeletonCard() {
  return (
    <li className="pcard" aria-hidden="true" style={{ listStyle: 'none' }}>
      <span className="pimg skel" />
      <span className="skel" style={{ height: 14, width: '70%' }} />
      <span className="skel" style={{ height: 16, width: '90%' }} />
      <span className="skel" style={{ height: 12, width: '35%' }} />
      <span className="skel" style={{ height: 20, width: '45%', marginTop: 'auto' }} />
      <span className="skel" style={{ height: 22, width: '60%' }} />
    </li>
  );
}
