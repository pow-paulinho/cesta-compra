/** Toasts with an optional action (undo). One at a time; a new one replaces the old. */
import { useSyncExternalStore } from 'react';

export interface Toast {
  id: number;
  text: string;
  tone?: 'info' | 'success' | 'error';
  action?: { label: string; run: () => void };
  ms?: number;
}

let current: Toast | null = null;
let seq = 0;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function toast(t: Omit<Toast, 'id'>) {
  current = { ...t, id: ++seq };
  if (timer) clearTimeout(timer);
  const id = current.id;
  timer = setTimeout(() => dismiss(id), t.ms ?? (t.action ? 6000 : 3500));
  emit();
}

export function dismiss(id?: number) {
  if (!current || (id != null && current.id !== id)) return;
  current = null;
  emit();
}

/** Pauses auto-dismiss while the pointer or focus is on the toast. */
export function holdToast(hold: boolean) {
  if (!current) return;
  if (timer) clearTimeout(timer);
  timer = null;
  if (!hold) {
    const id = current.id;
    timer = setTimeout(() => dismiss(id), 2500);
  }
}

export function useToast(): Toast | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
