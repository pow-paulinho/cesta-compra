import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTION_TOAST_MS,
  actionPath,
  currentToast,
  dismiss,
  holdToast,
  isUndo,
  isUndoShortcut,
  runToastAction,
  TOAST_MS,
  toast,
  UNDO_TOAST_MS,
  undoShortcut,
} from '../web/src/lib/toast';

const key = (k: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}, target: unknown = { tagName: 'BODY' }) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  target,
  ...mods,
});

describe('toasts', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    dismiss();
    vi.useRealTimers();
  });

  it('keeps an undo toast 10 s, other actions 5 s, plain ones 3.5 s', () => {
    toast({ text: 'Quitado', action: { label: 'Deshacer', run: () => {} } });
    vi.advanceTimersByTime(UNDO_TOAST_MS - 100);
    expect(currentToast()?.text).toBe('Quitado');
    vi.advanceTimersByTime(200);
    expect(currentToast()).toBeNull();

    toast({ text: 'Añadido', action: { label: 'Ver cesta', run: () => {} } });
    vi.advanceTimersByTime(ACTION_TOAST_MS + 10);
    expect(currentToast()).toBeNull();

    toast({ text: 'Hola' });
    vi.advanceTimersByTime(TOAST_MS + 10);
    expect(currentToast()).toBeNull();
  });

  it('does not close while held, and gives a few more seconds after', () => {
    toast({ text: 'Quitado', action: { label: 'Deshacer', run: () => {} } });
    holdToast(true);
    vi.advanceTimersByTime(60_000);
    expect(currentToast()).not.toBeNull();
    holdToast(false);
    vi.advanceTimersByTime(4000);
    expect(currentToast()).not.toBeNull();
    vi.advanceTimersByTime(1100);
    expect(currentToast()).toBeNull();
  });

  it('a new toast replaces the old one and the old timer does not close it', () => {
    toast({ text: 'uno' });
    vi.advanceTimersByTime(3000);
    toast({ text: 'dos' });
    vi.advanceTimersByTime(1000);
    expect(currentToast()?.text).toBe('dos');
  });

  it('Ctrl/Cmd+Z runs the undo of the current toast, once', () => {
    const run = vi.fn();
    toast({ text: 'Cesta vaciada', action: { label: 'Deshacer', run } });
    expect(undoShortcut(key('z', { metaKey: true }))).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
    expect(currentToast()).toBeNull();
    expect(undoShortcut(key('z', { ctrlKey: true }))).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('the shortcut leaves text fields and non-undo toasts alone', () => {
    const run = vi.fn();
    toast({ text: 'Añadido', action: { label: 'Ver cesta', run } });
    expect(undoShortcut(key('z', { ctrlKey: true }))).toBe(false);
    expect(run).not.toHaveBeenCalled();
    expect(isUndoShortcut(key('z', { ctrlKey: true }, { tagName: 'INPUT' }))).toBe(false);
    expect(isUndoShortcut(key('z', { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isUndoShortcut(key('z'))).toBe(false);
    expect(isUndoShortcut(key('Z', { ctrlKey: true }))).toBe(true);
  });

  it('runToastAction ignores a stale id', () => {
    const run = vi.fn();
    const id = toast({ text: 'a', action: { label: 'Deshacer', run } });
    toast({ text: 'b' });
    expect(runToastAction(id)).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it('knows undo and navigation actions', () => {
    expect(isUndo({ id: 1, text: '', action: { label: 'Deshacer', run: () => {} } })).toBe(true);
    expect(isUndo({ id: 1, text: '', action: { label: 'Reintentar', run: () => {}, undo: true } })).toBe(true);
    expect(isUndo({ id: 1, text: '' })).toBe(false);
    expect(actionPath({ label: 'Ver cesta', run: () => {} })).toBe('/cesta');
    expect(actionPath({ label: 'Ver plan', run: () => {}, path: '/plan' })).toBe('/plan');
    expect(actionPath({ label: 'Deshacer', run: () => {} })).toBeUndefined();
  });
});
