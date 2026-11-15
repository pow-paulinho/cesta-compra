import { describe, expect, it, vi } from 'vitest';

// The web app resolves @shared/* through Vite's alias; vitest has no config for it.
vi.mock('@shared/units', () => import('../src/shared/units'));
vi.mock('@shared/chains', () => import('../src/shared/chains'));
vi.mock('@shared/equiv', () => import('../src/shared/equiv'));
vi.mock('@shared/types', () => import('../src/shared/types'));
vi.mock('@shared/optimize', () => import('../src/shared/optimize'));
vi.mock('@shared/tips', () => import('../src/shared/tips'));

// Imported by a variable path: the root tsconfig type-checks tests without JSX.
type Tone = 'ok' | 'partial' | 'none';
interface Feedback {
  huntOutcomeText(priced: number, unpriced: string[]): { text: string; tone: Tone };
  huntRunningText(index: number, total: number): { text: string; count: string | null };
}
const FEEDBACK = '../web/src/components/feedback';
const { huntOutcomeText, huntRunningText } = (await import(/* @vite-ignore */ FEEDBACK)) as Feedback;

describe('hunt pill copy', () => {
  it('says what the hunt found, not always «Precios encontrados»', () => {
    expect(huntOutcomeText(1, [])).toEqual({ text: '¡Listo! Precio encontrado', tone: 'ok' });
    expect(huntOutcomeText(3, [])).toEqual({ text: '¡Listo! 3 con precio', tone: 'ok' });
    expect(huntOutcomeText(3, ['Leche Milbona'])).toEqual({ text: '¡Listo! 3 con precio · 1 sin precio', tone: 'partial' });
    expect(huntOutcomeText(0, ['Leche Milbona'])).toEqual({ text: 'Sin precio para Leche Milbona: prueba otra marca', tone: 'none' });
    expect(huntOutcomeText(0, ['a', 'b'])).toEqual({ text: 'Sin precio para 2 productos: prueba otra marca', tone: 'none' });
    expect(huntOutcomeText(0, []).tone).toBe('ok');
  });

  it('names the unit it counts while running', () => {
    expect(huntRunningText(1, 1)).toEqual({ text: 'Buscando precios…', count: null });
    expect(huntRunningText(2, 5)).toEqual({ text: 'Buscando producto', count: '2 de 5' });
    expect(huntRunningText(0, 3).count).toBe('1 de 3');
  });
});
