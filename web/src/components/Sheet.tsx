/**
 * Bottom sheet on mobile (drag down to dismiss, velocity-aware, spring back),
 * centered panel on desktop. Focus is trapped inside and restored on close.
 */
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import { motion, useDragControls, type PanInfo } from 'motion/react';
import { Icon } from './Icon';
import { useIsDesktop, useScrollLock } from '../lib/hooks';
import { DUR, EASE_DRAWER, EASE_OUT } from '../lib/motion';

/** Lets content (the product photo) start the sheet drag on mobile. */
const DragStart = createContext<(e: React.PointerEvent) => void>(() => {});
export const useSheetDrag = () => useContext(DragStart);

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Makes everything outside the sheet inert (header, page, tab bar, dock), so neither Tab nor a
 * screen reader can reach the page behind an aria-modal dialog. Walks up from the sheet and marks
 * the siblings at each level, wherever the sheet is mounted; returns the undo.
 */
const inertHolds = new Map<HTMLElement, number>();

function inertOutside(sheet: HTMLElement, keep: HTMLElement | null): () => void {
  const marked: HTMLElement[] = [];
  for (let node: HTMLElement | null = sheet; node && node !== document.body; node = node.parentElement) {
    const parent: HTMLElement | null = node.parentElement;
    if (!parent) break;
    for (const sib of parent.children) {
      if (sib === node || sib === keep || !(sib instanceof HTMLElement) || sib.contains(sheet)) continue;
      if (sib.tagName === 'SCRIPT' || sib.tagName === 'STYLE') continue;
      const holds = inertHolds.get(sib) ?? 0;
      if (!holds && sib.inert) continue; // made inert by someone else: not ours to undo
      inertHolds.set(sib, holds + 1);
      sib.inert = true;
      marked.push(sib);
    }
  }
  // Counted, so a sheet that is still leaving does not wake the page under the sheet replacing it.
  return () => {
    for (const el of marked) {
      const holds = (inertHolds.get(el) ?? 1) - 1;
      if (holds > 0) inertHolds.set(el, holds);
      else {
        inertHolds.delete(el);
        el.inert = false;
      }
    }
  };
}

export function Sheet({ onClose, label, children }: { onClose: () => void; label: string; children: ReactNode }) {
  const desktop = useIsDesktop();
  const controls = useDragControls();
  const ref = useRef<HTMLDivElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useScrollLock(true);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.focus(), 30);
    const freed = ref.current ? inertOutside(ref.current, backdropRef.current) : () => {};
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // A popover inside the sheet claims Escape first (and prevents it): only the top layer closes.
        if (e.defaultPrevented) return;
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const first = els[0]!;
      const last = els[els.length - 1]!;
      const at = document.activeElement;
      // Focus can fall to <body> when the focused control unmounts or gets disabled: bring it back in.
      if (!at || !ref.current.contains(at)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && (at === first || at === ref.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && at === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
      freed();
      prev?.focus?.({ preventScroll: true });
    };
  }, []);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 140 || info.velocity.y > 600) onClose();
  };
  const start = (e: React.PointerEvent) => !desktop && controls.start(e);

  return (
    <>
      <motion.div
        ref={backdropRef}
        className="backdrop"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: DUR.slow, ease: EASE_OUT }}
        onClick={onClose}
        aria-hidden="true"
      />
      <motion.div
        ref={ref}
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        {...(desktop
          ? {
              initial: { opacity: 0, scale: 0.96, x: '-50%', y: '-48%' },
              animate: { opacity: 1, scale: 1, x: '-50%', y: '-50%' },
              exit: { opacity: 0, scale: 0.97, x: '-50%', y: '-49%', transition: { duration: DUR.base, ease: EASE_OUT } },
              transition: { duration: DUR.slow, ease: EASE_OUT },
            }
          : {
              initial: { y: '100%' },
              animate: { y: 0 },
              exit: { y: '100%', transition: { duration: DUR.base, ease: EASE_DRAWER } },
              transition: { duration: 0.32, ease: EASE_DRAWER },
              drag: 'y' as const,
              dragListener: false,
              dragControls: controls,
              dragConstraints: { top: 0, bottom: 0 },
              dragElastic: { top: 0.04, bottom: 0.9 },
              dragTransition: { bounceStiffness: 500, bounceDamping: 36 },
              onDragEnd,
            })}
      >
        <div className="sheet-grab" onPointerDown={start} aria-hidden="true">
          <span />
        </div>
        <button type="button" className="icon-btn sheet-close" onClick={onClose} aria-label="Cerrar">
          <Icon name="close" />
        </button>
        <div className="sheet-body">
          <DragStart.Provider value={start}>{children}</DragStart.Provider>
        </div>
      </motion.div>
    </>
  );
}
