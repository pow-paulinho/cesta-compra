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

export function Sheet({ onClose, label, children }: { onClose: () => void; label: string; children: ReactNode }) {
  const desktop = useIsDesktop();
  const controls = useDragControls();
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useScrollLock(true);

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const t = setTimeout(() => ref.current?.focus(), 30);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeRef.current();
      }
      if (e.key !== 'Tab' || !ref.current) return;
      const els = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
      if (!els.length) return;
      const first = els[0]!;
      const last = els[els.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener('keydown', onKey);
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
