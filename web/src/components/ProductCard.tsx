import { forwardRef } from 'react';
import { motion } from 'motion/react';
import type { Offer, Product } from '@shared/types';
import { formatEuros } from '@shared/units';
import { ChainDots, ProductImg } from './ui';
import { nameWithoutBrand, unitPriceLabel } from '../lib/format';
import { DUR, EASE_OUT, stagger } from '../lib/motion';

export function cheapest(offers: Offer[]): Offer | null {
  let best: Offer | null = null;
  for (const o of offers) if (o.priceCents > 0 && (!best || o.priceCents < best.priceCents)) best = o;
  return best;
}

export const ProductCard = forwardRef<HTMLLIElement, { product: Product; index: number; onOpen: (p: Product) => void }>(function ProductCard({ product: p, index, onOpen }, ref) {
  const best = cheapest(p.offers);
  const unit = best ? unitPriceLabel(best) : null;
  const meta = [p.brand, p.sizeText].filter(Boolean).join(' · ');
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
      <button type="button" className="pcard" onClick={() => onOpen(p)} aria-label={`${p.name}${meta ? `, ${meta}` : ''}${best ? `, desde ${formatEuros(best.priceCents)}` : ', sin precio todavía'}`}>
        <span className="pimg">
          <ProductImg src={p.image} alt="" />
        </span>
        <span className="name">{nameWithoutBrand(p.name, p.brand)}</span>
        <span className="meta">{meta || ' '}</span>
        <span className="foot">
          {best ? (
            <span>
              <span className="price">
                <small>desde</small>
                {formatEuros(best.priceCents)}
              </span>
              {unit && <span className="unit" style={{ display: 'block' }}>{unit}</span>}
            </span>
          ) : (
            <span className="unit">Sin precio aún: añádelo y lo buscamos</span>
          )}
          <ChainDots chains={p.offers.map((o) => o.chain)} />
        </span>
      </button>
    </motion.li>
  );
});

export function SkeletonCard() {
  return (
    <li className="pcard" aria-hidden="true" style={{ listStyle: 'none' }}>
      <span className="pimg skel" />
      <span className="skel" style={{ height: 16, width: '90%' }} />
      <span className="skel" style={{ height: 16, width: '60%' }} />
      <span className="skel" style={{ height: 12, width: '45%', marginTop: 4 }} />
      <span className="skel" style={{ height: 22, width: '50%', marginTop: 'auto' }} />
    </li>
  );
}
