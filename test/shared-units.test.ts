import { describe, expect, it } from 'vitest';
import {
  formatAmount,
  formatEuros,
  formatNumber,
  formatSize,
  formatUnitPrice,
  NBSP,
  parseSize,
  priceUnitOf,
  sizeFromName,
  totalAmount,
  unitPriceCents,
  type Size,
} from '../src/shared/units';

const S = (count: number, amount: number, unit: Size['unit']): Size => ({ count, amount, unit });

describe('parseSize', () => {
  it.each([
    ['1 L', S(1, 1000, 'ml')],
    ['1l', S(1, 1000, 'ml')],
    ['1,5 L', S(1, 1500, 'ml')],
    ['0,75 l', S(1, 750, 'ml')],
    ['6 x 1 L', S(6, 1000, 'ml')],
    ['6x1L', S(6, 1000, 'ml')],
    ['Agua 6×1,5L', S(6, 1500, 'ml')],
    ['Pack 6 x 200 ml', S(6, 200, 'ml')],
    ['500 g', S(1, 500, 'g')],
    ['500gr', S(1, 500, 'g')],
    ['1,5 kg', S(1, 1500, 'g')],
    ['1.0 Kg', S(1, 1000, 'g')],
    ['3 l unidad', S(1, 3000, 'ml')],
    ['6000ml', S(1, 6000, 'ml')],
    ['33 cl', S(1, 330, 'ml')],
    ['70cl', S(1, 700, 'ml')],
    ['250 ML', S(1, 250, 'ml')],
    ['5 Litros', S(1, 5000, 'ml')],
    ['12 ud', S(1, 12, 'ud')],
    ['12 unidades', S(1, 12, 'ud')],
    ['docena', S(1, 12, 'ud')],
    ['media docena', S(1, 6, 'ud')],
    ['2 docenas', S(1, 24, 'ud')],
    ['6 huevos', S(1, 6, 'ud')],
    ['Paquete 250 g', S(1, 250, 'g')],
    ['4 x 125 g', S(4, 125, 'g')],
    ['garrafa 5 l', S(1, 5000, 'ml')],
  ])('reads %j', (text, size) => {
    expect(parseSize(text)).toEqual(size);
  });

  it('reads multipacks written in other orders', () => {
    expect(parseSize('125 g x 4')).toEqual(S(4, 125, 'g'));
    expect(parseSize('1 l pack 6')).toEqual(S(6, 1000, 'ml'));
    expect(parseSize('6 latas de 33 cl')).toEqual(S(6, 330, 'ml'));
    expect(parseSize('Pack 6 botellas agua 1,5 l')).toEqual(S(6, 1500, 'ml'));
    expect(parseSize('Pack 4 yogures 125 g')).toEqual(S(4, 125, 'g'));
    expect(parseSize('4 ud x 125 g')).toEqual(S(4, 125, 'g'));
    expect(parseSize('2 x 6 x 33 cl')).toEqual(S(12, 330, 'ml'));
    expect(parseSize('3 x 4 ud')).toEqual(S(3, 4, 'ud'));
  });

  it('tells a thousands dot from a decimal one, and reads fractions', () => {
    expect(parseSize('1.000 g')).toEqual(S(1, 1000, 'g'));
    expect(parseSize('1.500 ml')).toEqual(S(1, 1500, 'ml'));
    expect(parseSize('1.500 kg')).toEqual(S(1, 1500, 'g'));
    expect(parseSize('1/2 kg')).toEqual(S(1, 500, 'g'));
    expect(parseSize('medio kilo')).toEqual(S(1, 500, 'g'));
    expect(parseSize('cuarto de kilo')).toEqual(S(1, 250, 'g'));
  });

  it('prefers the weight of a box of pieces when no "x" ties them', () => {
    expect(parseSize('12 ud 730 g')).toEqual(S(1, 730, 'g'));
  });

  it('does not take a pack of a measure for a count', () => {
    expect(parseSize('Pack de 2 kg')).toEqual(S(1, 2000, 'g'));
  });

  it('accepts a size text that is only a unit', () => {
    expect(parseSize('kg')).toEqual(S(1, 1000, 'g'));
    expect(parseSize('/kg')).toEqual(S(1, 1000, 'g'));
    expect(parseSize('litro')).toEqual(S(1, 1000, 'ml'));
    expect(parseSize('unidad')).toEqual(S(1, 1, 'ud'));
  });

  it('ignores numbers that are not sizes', () => {
    expect(parseSize('Leche 3,6% MG 1 L')).toEqual(S(1, 1000, 'ml'));
    expect(parseSize('Cerveza 0,0 33 cl')).toEqual(S(1, 330, 'ml'));
    expect(parseSize('Vitamina C 1000 mg')).toBeNull();
    expect(parseSize('Huevos clase L')).toBeNull();
  });

  it('returns null for missing or unreadable sizes', () => {
    expect(parseSize(null)).toBeNull();
    expect(parseSize(undefined)).toBeNull();
    expect(parseSize('')).toBeNull();
    expect(parseSize('   ')).toBeNull();
    expect(parseSize('al peso')).toBeNull();
    expect(parseSize('x6')).toBeNull();
    expect(parseSize('0 g')).toBeNull();
    expect(parseSize('0 x 1 l')).toBeNull();
  });
});

describe('sizeFromName', () => {
  it('finds the size inside a product name', () => {
    expect(sizeFromName('Leche entera Hacendado 6 x 1 L')).toEqual(S(6, 1000, 'ml'));
    expect(sizeFromName('Aceite de oliva virgen extra Carbonell 1 l')).toEqual(S(1, 1000, 'ml'));
    expect(sizeFromName('Huevos frescos camperos docena')).toEqual(S(1, 12, 'ud'));
    expect(sizeFromName('Huevos L 12 ud')).toEqual(S(1, 12, 'ud'));
    expect(sizeFromName('Tomate frito 0,35 kg')).toEqual(S(1, 350, 'g'));
  });

  it('does not read a bare unit word in a name as a size', () => {
    expect(sizeFromName('Plátano de Canarias kg')).toBeNull();
    expect(sizeFromName('Pan de pueblo unidad')).toBeNull();
    expect(sizeFromName('Leche semidesnatada')).toBeNull();
  });
});

describe('amounts and unit prices', () => {
  it('totals a size', () => {
    expect(totalAmount(S(6, 1000, 'ml'))).toBe(6000);
    expect(totalAmount(S(3, 4, 'ud'))).toBe(12);
    expect(totalAmount(S(3, 0.1, 'g'))).toBe(0.3);
  });

  it('maps base units to price units', () => {
    expect(priceUnitOf('g')).toBe('kg');
    expect(priceUnitOf('ml')).toBe('l');
    expect(priceUnitOf('ud')).toBe('ud');
  });

  it('computes price per kg, litre and unit', () => {
    expect(unitPriceCents(475, parseSize('6 x 1 L'))).toEqual({ cents: 79, unit: 'l' });
    expect(unitPriceCents(101, parseSize('250 g'))).toEqual({ cents: 404, unit: 'kg' });
    expect(unitPriceCents(300, parseSize('12 ud'))).toEqual({ cents: 25, unit: 'ud' });
    expect(unitPriceCents(99, parseSize('33 cl'))).toEqual({ cents: 300, unit: 'l' });
  });

  it('has no unit price without a size or a valid price', () => {
    expect(unitPriceCents(100, null)).toBeNull();
    expect(unitPriceCents(Number.NaN, S(1, 1000, 'ml'))).toBeNull();
    expect(unitPriceCents(-5, S(1, 1000, 'ml'))).toBeNull();
    expect(unitPriceCents(100, S(1, 0, 'ml'))).toBeNull();
  });
});

describe('formatting', () => {
  it('formats euros the es-ES way with a non-breaking space', () => {
    expect(formatEuros(123)).toBe(`1,23${NBSP}€`);
    expect(formatEuros(5)).toBe(`0,05${NBSP}€`);
    expect(formatEuros(0)).toBe(`0,00${NBSP}€`);
    expect(formatEuros(-50)).toBe(`-0,50${NBSP}€`);
    expect(formatEuros(-0.4)).toBe(`0,00${NBSP}€`);
    expect(formatEuros(12.6)).toBe(`0,13${NBSP}€`);
    expect(formatEuros(123456)).toBe(`1234,56${NBSP}€`);
    expect(formatEuros(1234567)).toBe(`12.345,67${NBSP}€`);
    expect(formatEuros(123456789)).toBe(`1.234.567,89${NBSP}€`);
    expect(formatEuros(Number.NaN)).toBe(`-${NBSP}€`);
  });

  it('formats unit prices', () => {
    expect(formatUnitPrice(89, 'l')).toBe(`0,89${NBSP}€/L`);
    expect(formatUnitPrice(404, 'kg')).toBe(`4,04${NBSP}€/kg`);
    expect(formatUnitPrice(25, 'ud')).toBe(`0,25${NBSP}€/ud`);
  });

  it('formats numbers with a decimal comma and no trailing zeros', () => {
    expect(formatNumber(1.5)).toBe('1,5');
    expect(formatNumber(2)).toBe('2');
    expect(formatNumber(0.333)).toBe('0,33');
    expect(formatNumber(-1.25)).toBe('-1,25');
    expect(formatNumber(12345.5)).toBe('12.345,5');
  });

  it('formats sizes in their friendliest unit', () => {
    expect(formatSize(S(6, 1000, 'ml'))).toBe('6 × 1 L');
    expect(formatSize(S(1, 500, 'g'))).toBe('500 g');
    expect(formatSize(S(1, 1500, 'g'))).toBe('1,5 kg');
    expect(formatSize(S(1, 330, 'ml'))).toBe('330 ml');
    expect(formatSize(S(1, 1500, 'ml'))).toBe('1,5 L');
    expect(formatSize(S(1, 12, 'ud'))).toBe('12 ud');
    expect(formatSize(S(3, 4, 'ud'))).toBe('3 × 4 ud');
    expect(formatAmount(4000, 'ml')).toBe('4 L');
  });

  it('round-trips what it formats', () => {
    for (const text of ['6 x 1 L', '500 g', '1,5 kg', '330 ml', '12 ud', '4 x 125 g']) {
      const s = parseSize(text)!;
      expect(parseSize(formatSize(s))).toEqual(s);
    }
  });
});
