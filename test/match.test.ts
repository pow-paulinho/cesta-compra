import { describe, expect, it } from 'vitest';
import { group, matchKey, normalise } from '../src/match';

describe('matching', () => {
  it('matches on EAN first, padding EAN-8 and EAN-13 alike', () => {
    expect(matchKey({ ean: '8410014477743', name: 'x' })).toEqual({ key: 'ean:8410014477743', confidence: 'ean' });
    expect(matchKey({ ean: '80177173', name: 'x' }).key).toBe('ean:0000080177173');
  });

  it('normalises names, accents and sizes', () => {
    expect(normalise('Café 1 L')).toBe('cafe 1000ml');
    expect(normalise('Tomate frito 0,35 kg')).toBe('tomate frito 350g');
    expect(normalise('Agua 50cl')).toBe('agua 500ml');
  });

  it('groups listings without EAN by brand, name and size, as a likely match', () => {
    const g = group([
      { name: 'Tomate Frito', brand: 'Orlando', size: '350 g' },
      { name: 'tomate frito', brand: 'ORLANDO', size: '0,35 kg' },
      { name: 'Tomate frito', brand: 'Solís', size: '350 g' },
      { ean: '8410066111459', name: 'Tomate frito Orlando 630 g' },
    ]);
    expect(g.map((x) => [x.confidence, x.items.length]).sort()).toEqual([['ean', 1], ['name', 1], ['name', 2]]);
  });
});
