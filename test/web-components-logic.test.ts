/**
 * The pure helpers behind the UI primitives (web/src/components/ui-logic.ts): the quantity
 * stepper's commit, hints and spin keys, where an info popover goes so it stays on screen,
 * and the price range and chain order on the product cards.
 */
import { describe, expect, it } from 'vitest';
import { chainsByPrice, commitQty, placePopover, priceRange, qtyDraft, qtyHintText, stepKey, takeWithMore, unitsLabel } from '../web/src/components/ui-logic';

describe('quantity stepper', () => {
  it('keeps what was typed (digits only) instead of cutting it to two digits', () => {
    expect(qtyDraft('120')).toBe('120');
    expect(qtyDraft('1a2')).toBe('12');
    expect(qtyDraft('12345')).toBe('123');
  });

  it('clamps on commit and says why', () => {
    expect(commitQty('120', 3, 1, 99)).toEqual({ value: 99, hint: 'max' });
    expect(commitQty('0', 3, 1, 99)).toEqual({ value: 1, hint: 'min' });
    expect(commitQty('7', 3, 1, 99)).toEqual({ value: 7, hint: null });
    expect(commitQty('', 3, 1, 99)).toEqual({ value: 3, hint: null });
  });

  it('words the hint and the spoken value in Spanish', () => {
    expect(qtyHintText('max', 1, 99)).toBe('Máximo 99 unidades');
    expect(qtyHintText('min', 1, 99)).toBe('Mínimo 1 unidad');
    expect(unitsLabel(1)).toBe('1 unidad');
    expect(unitsLabel(2)).toBe('2 unidades');
  });

  it('answers the spinbutton keys within the limits', () => {
    expect(stepKey('ArrowUp', 5, 1, 99)).toBe(6);
    expect(stepKey('ArrowDown', 1, 1, 99)).toBe(1);
    expect(stepKey('PageUp', 95, 1, 99)).toBe(99);
    expect(stepKey('PageDown', 5, 1, 99)).toBe(1);
    expect(stepKey('Home', 50, 1, 99)).toBe(1);
    expect(stepKey('End', 50, 1, 99)).toBe(99);
    expect(stepKey('a', 50, 1, 99)).toBeNull();
    expect(stepKey('Tab', 50, 1, 99)).toBeNull();
  });
});

describe('info popover placement', () => {
  const inside = (triggerLeft: number, triggerWidth: number, vw: number) => {
    const p = placePopover(triggerLeft, triggerWidth, vw);
    const left = triggerLeft + p.offset;
    return { ...p, left, right: left + p.width };
  };

  it('opens left-aligned under the trigger when it fits', () => {
    const p = inside(20, 100, 390);
    expect(p.offset).toBe(0);
    expect(p.width).toBe(280);
  });

  it('never runs off a 390 px screen, wherever the trigger is (cart chips at x=134 and x=148, a pill at x=186)', () => {
    for (const x of [16, 134, 148, 186, 250, 300]) {
      const p = inside(x, 90, 390);
      expect(p.left).toBeGreaterThanOrEqual(16);
      expect(p.right).toBeLessThanOrEqual(390 - 16);
    }
  });

  it('right-aligns with the trigger when that is what fits', () => {
    const p = inside(250, 112, 390);
    expect(p.right).toBe(362);
  });

  it('shrinks on very narrow screens and grows out of the trigger', () => {
    const p = inside(100, 40, 280);
    expect(p.width).toBe(248);
    expect(p.left).toBe(16);
    expect(p.originX).toBe(100 + 20 - 16);
  });
});

describe('product card price range and chains', () => {
  it('spans the positive prices only', () => {
    expect(priceRange([151, 113, 0, 129])).toEqual({ min: 113, max: 151 });
    expect(priceRange([0, -1])).toBeNull();
    expect(priceRange([])).toBeNull();
  });

  it('lists each chain once, cheapest first, priceless last', () => {
    const offers = [
      { chain: 'supercor', priceCents: 151 },
      { chain: 'lidl', priceCents: 113 },
      { chain: 'aldi', priceCents: 0 },
      { chain: 'supercor', priceCents: 120 },
      { chain: 'carrefour', priceCents: 129 },
    ];
    expect(chainsByPrice(offers)).toEqual(['lidl', 'supercor', 'carrefour', 'aldi']);
  });

  it('shows three and "+N" for the rest, but never "+1"', () => {
    expect(takeWithMore(['a', 'b', 'c', 'd', 'e'])).toEqual({ shown: ['a', 'b', 'c'], more: 2 });
    expect(takeWithMore(['a', 'b', 'c', 'd'])).toEqual({ shown: ['a', 'b', 'c', 'd'], more: 0 });
    expect(takeWithMore(['a'])).toEqual({ shown: ['a'], more: 0 });
  });
});
