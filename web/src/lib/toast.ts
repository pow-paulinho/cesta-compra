/**
 * Toasts with an optional action (undo). One at a time; a new one replaces the old.
 *
 * An undo toast stays 10 s (WCAG 2.2.1: enough time to reach it from the
 * keyboard) and also runs with Ctrl/Cmd+Z (see `undoShortcut`). Every toast
 * pauses while the pointer or focus is on it.
 */
import { useSyncExternalStore } from 'react';

export interface ToastAction {
  label: string;
  run: () => void;
  /** Ctrl/Cmd+Z runs it. Defaults to true when the label is «Deshacer». */
  undo?: boolean;
  /** A navigation action ("Ver cesta"): hidden while the app is already on this path. */
  path?: string;
}

export interface Toast {
  id: number;
  text: string;
  tone?: 'info' | 'success' | 'error';
  action?: ToastAction;
  ms?: number;
}

export const TOAST_MS = 3500;
/** An undo stays long enough to reach from the keyboard; other actions ("Ver cesta") a little less. */
export const UNDO_TOAST_MS = 10_000;
export const ACTION_TOAST_MS = 5000;
/** Time left once the pointer or focus leaves a toast it was holding. */
export const RESUME_MS = 2500;
export const ACTION_RESUME_MS = 5000;

let current: Toast | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
let held = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function schedule(ms: number) {
  if (timer) clearTimeout(timer);
  timer = null;
  if (!current || held) return;
  const id = current.id;
  timer = setTimeout(() => dismiss(id), ms);
}

export function toast(t: Omit<Toast, 'id'>): number {
  current = { ...t, id: ++seq };
  held = false;
  schedule(t.ms ?? (isUndo(current) ? UNDO_TOAST_MS : t.action ? ACTION_TOAST_MS : TOAST_MS));
  emit();
  return current.id;
}

export function dismiss(id?: number) {
  if (!current || (id != null && current.id !== id)) return;
  current = null;
  held = false;
  if (timer) clearTimeout(timer);
  timer = null;
  emit();
}

/** Pauses auto-dismiss while the pointer or focus is on the toast; resumes with a few seconds left. */
export function holdToast(hold: boolean) {
  if (!current) return;
  held = hold;
  schedule(current.action ? ACTION_RESUME_MS : RESUME_MS);
}

/** Runs the action of the current toast (or of toast `id`) and closes it. */
export function runToastAction(id?: number): boolean {
  const t = current;
  if (!t?.action || (id != null && t.id !== id)) return false;
  dismiss(t.id);
  t.action.run();
  return true;
}

export const isUndo = (t: Toast | null): boolean => !!t?.action && (t.action.undo ?? /^deshacer$/i.test(t.action.label.trim()));

/** Where a navigation action goes: `path`, or /cesta for the «Ver cesta» toasts. */
export const actionPath = (a: ToastAction | undefined): string | undefined => a?.path ?? (a && /^ver cesta$/i.test(a.label.trim()) ? '/cesta' : undefined);

/** The parts of a KeyboardEvent the shortcut reads. */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  target: unknown;
}

/** True when the keyboard event is the undo shortcut and nothing editable has focus. */
export function isUndoShortcut(e: KeyLike): boolean {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z') return false;
  const el = e.target as { tagName?: string; isContentEditable?: boolean } | null;
  const tag = el?.tagName?.toLowerCase();
  return !(tag === 'input' || tag === 'textarea' || tag === 'select' || el?.isContentEditable);
}

/** Ctrl/Cmd+Z: runs the undo of the current toast. Returns true when it did. */
export function undoShortcut(e: KeyLike): boolean {
  if (!isUndoShortcut(e) || !isUndo(current)) return false;
  return runToastAction();
}

export const currentToast = () => current;

export function useToast(): Toast | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
