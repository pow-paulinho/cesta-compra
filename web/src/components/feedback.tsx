/** Number ticker, confetti, the status dock (hunt pill + toast). */
import { useEffect, useMemo, useState } from 'react';
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { formatEuros } from '@shared/units';
import { Icon } from './Icon';
import { DUR, EASE_OUT } from '../lib/motion';
import { useHuntProgress } from '../lib/hunt';
import { dismiss, holdToast, useToast } from '../lib/toast';
import { hrefFor, useRoute } from '../lib/router';

// ---------------------------------------------------------------------------
// Ticker: animates a money amount between values
// ---------------------------------------------------------------------------

export function Ticker({ cents, format = formatEuros, duration = 0.6 }: { cents: number; format?: (c: number) => string; duration?: number }) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(cents);
  const text = useTransform(mv, (v) => format(Math.round(v)));
  useEffect(() => {
    if (reduce) {
      mv.set(cents);
      return;
    }
    const c = animate(mv, cents, { duration, ease: EASE_OUT });
    return () => c.stop();
  }, [cents, duration, mv, reduce]);
  return (
    <>
      <motion.span aria-hidden="true">{text}</motion.span>
      <span className="sr-only">{format(cents)}</span>
    </>
  );
}

// ---------------------------------------------------------------------------
// Confetti: a few particles, transform/opacity only, off under reduced motion
// ---------------------------------------------------------------------------

const COLORS = ['#58CC02', '#1CB0F6', '#FFC800', '#FF9600', '#FF4B4B', '#CE82FF'];

export function Confetti({ fire }: { fire: number }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!fire || reduce) return;
    setShown(fire);
    const t = setTimeout(() => setShown(0), 1900);
    return () => clearTimeout(t);
  }, [fire, reduce]);
  const parts = useMemo(
    () =>
      Array.from({ length: 26 }, (_, i) => {
        const angle = (-90 + (Math.random() * 2 - 1) * 70) * (Math.PI / 180);
        const speed = 260 + Math.random() * 260;
        return {
          i,
          color: COLORS[i % COLORS.length]!,
          dx: Math.cos(angle) * speed,
          dy: Math.sin(angle) * speed,
          rot: (Math.random() * 2 - 1) * 540,
          delay: Math.random() * 0.08,
          w: 7 + Math.random() * 6,
        };
      }),
    [shown], // a new set of particles per burst
  );
  if (!shown) return null;
  const ox = window.innerWidth / 2;
  const oy = Math.min(window.innerHeight * 0.35, 280);
  return (
    <div className="confetti" aria-hidden="true">
      {parts.map((p) => (
        <motion.i
          key={`${shown}-${p.i}`}
          style={{ background: p.color, width: p.w }}
          initial={{ x: ox, y: oy, opacity: 1, rotate: 0, scale: 0.9 }}
          animate={{ x: [ox, ox + p.dx * 0.8, ox + p.dx], y: [oy, oy + p.dy, oy + p.dy + 420], rotate: p.rot, opacity: [1, 1, 0], scale: 1 }}
          transition={{ duration: 1.5, delay: p.delay, ease: [0.2, 0.7, 0.4, 1], times: [0, 0.35, 1] }}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dock: global hunt progress pill and the toast
// ---------------------------------------------------------------------------

export function Dock() {
  const hunt = useHuntProgress();
  const t = useToast();
  const route = useRoute();
  const finished = hunt.active && !hunt.current && hunt.done >= hunt.total;
  const index = Math.min(hunt.total, hunt.done + (hunt.current ? 1 : 0));
  return (
    <div className="dock">
      <div aria-live="polite" className="sr-only">
        {hunt.active ? (finished ? 'Búsqueda en los súper terminada.' : `Buscando en los súper, ${index} de ${hunt.total}.`) : ''}
      </div>
      <AnimatePresence initial={false}>
        {hunt.active && (
          <motion.a
            key="hunt"
            layout
            href={route.path === '/cesta' ? undefined : hrefFor('/cesta')}
            className="hunt-pill"
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: DUR.slow, ease: EASE_OUT }}
            aria-label={finished ? 'Búsqueda terminada. Ver cesta' : `Buscando en los súper, ${index} de ${hunt.total}. Ver cesta`}
          >
            {finished ? <Icon name="check" size={18} style={{ color: 'var(--green)' }} /> : <span className="spin" aria-hidden="true" />}
            <span>{finished ? '¡Listo! Precios encontrados' : 'Buscando en los súper…'}</span>
            <span className="count">
              {index}/{hunt.total}
            </span>
          </motion.a>
        )}
      </AnimatePresence>
      <div role="status" aria-live="polite" className="toast-slot">
        <AnimatePresence mode="popLayout">
          {t && (
            <motion.div
              key={t.id}
              layout
              className={`toast ${t.tone === 'error' ? 'error' : ''}`}
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: DUR.fast } }}
              transition={{ duration: DUR.slow, ease: EASE_OUT }}
              onPointerEnter={() => holdToast(true)}
              onPointerLeave={() => holdToast(false)}
              onFocus={() => holdToast(true)}
              onBlur={() => holdToast(false)}
            >
              <span className="text">{t.text}</span>
              {t.action && (
                <button
                  type="button"
                  onClick={() => {
                    t.action!.run();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              )}
              <button type="button" aria-label="Cerrar aviso" onClick={() => dismiss(t.id)} style={{ color: 'inherit', padding: '0 10px' }}>
                <Icon name="close" size={18} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
