/** Number ticker, confetti, the status dock (hunt pill + toast). */
import { useEffect, useMemo, useRef, useState } from 'react';
import { animate, AnimatePresence, motion, useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { formatEuros } from '@shared/units';
import { Icon } from './Icon';
import { DUR, EASE_OUT } from '../lib/motion';
import { useHuntProgress } from '../lib/hunt';
import { bestPrice } from '../lib/cart';
import { useStore } from '../lib/store';
import { actionPath, dismiss, holdToast, isUndo, runToastAction, undoShortcut, useToast } from '../lib/toast';
import { hrefFor, useRoute } from '../lib/router';
import '../styles/plan.css';

// ---------------------------------------------------------------------------
// Ticker: animates a money amount between values
// ---------------------------------------------------------------------------

/**
 * Counts to `cents`. `from` sets where the first count starts (the plan counts
 * down from the single-store total); `onDone` runs when a count lands, or at
 * once under reduced motion.
 */
export function Ticker({
  cents,
  from,
  format = formatEuros,
  duration = 0.6,
  onDone,
}: {
  cents: number;
  from?: number;
  format?: (c: number) => string;
  duration?: number;
  onDone?: () => void;
}) {
  const reduce = useReducedMotion();
  const mv = useMotionValue(reduce ? cents : from ?? cents);
  const text = useTransform(mv, (v) => format(Math.round(v)));
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    if (reduce || mv.get() === cents) {
      mv.set(cents);
      done.current?.();
      return;
    }
    const c = animate(mv, cents, { duration, ease: EASE_OUT });
    let stopped = false;
    void c.then(() => {
      if (!stopped) done.current?.();
    });
    return () => {
      stopped = true;
      c.stop();
    };
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

/**
 * One burst per new `fire` value. `origin` is read when the burst starts (the
 * saving banner, so the confetti comes out of the good news); `small` is a
 * modest pop for a modest saving.
 */
export function Confetti({ fire, origin, small = false }: { fire: number; origin?: () => DOMRect | null | undefined; small?: boolean }) {
  const reduce = useReducedMotion();
  const [burst, setBurst] = useState<{ n: number; x: number; y: number; small: boolean } | null>(null);
  const originRef = useRef(origin);
  originRef.current = origin;
  useEffect(() => {
    if (!fire || reduce) return;
    const r = originRef.current?.();
    const x = r ? r.left + r.width / 2 : window.innerWidth / 2;
    const y = r ? r.top + Math.min(r.height / 2, 24) : Math.min(window.innerHeight * 0.35, 280);
    setBurst({ n: fire, x, y, small });
    const t = setTimeout(() => setBurst(null), 1900);
    return () => clearTimeout(t);
  }, [fire, reduce]); // eslint-disable-line react-hooks/exhaustive-deps -- `small` is read with the burst
  const parts = useMemo(() => {
    if (!burst) return [];
    const count = burst.small ? 10 : 26;
    const reach = burst.small ? 0.55 : 1;
    return Array.from({ length: count }, (_, i) => {
      const angle = (-90 + (Math.random() * 2 - 1) * 70) * (Math.PI / 180);
      const speed = (260 + Math.random() * 260) * reach;
      return {
        i,
        color: COLORS[i % COLORS.length]!,
        dx: Math.cos(angle) * speed,
        dy: Math.sin(angle) * speed,
        rot: (Math.random() * 2 - 1) * 540,
        delay: Math.random() * 0.08,
        w: 7 + Math.random() * 6,
      };
    });
  }, [burst]);
  if (!burst) return null;
  const { x: ox, y: oy } = burst;
  return (
    <div className="confetti" aria-hidden="true">
      {parts.map((p) => (
        <motion.i
          key={`${burst.n}-${p.i}`}
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

/** What the pill says once a batch of hunts ends: how many found a price, and which did not. */
export function huntOutcomeText(priced: number, unpriced: string[]): { text: string; tone: 'ok' | 'partial' | 'none' } {
  const u = unpriced.length;
  if (!priced && !u) return { text: 'Búsqueda terminada', tone: 'ok' };
  if (!u) return { text: priced === 1 ? '¡Listo! Precio encontrado' : `¡Listo! ${priced} con precio`, tone: 'ok' };
  if (priced) return { text: `¡Listo! ${priced} con precio · ${u} sin precio`, tone: 'partial' };
  return { text: u === 1 ? `Sin precio para ${unpriced[0]}: prueba otra marca` : `Sin precio para ${u} productos: prueba otra marca`, tone: 'none' };
}

/** "Buscando precios…" for one product, "Buscando producto · 2 de 5" for a batch. */
export function huntRunningText(index: number, total: number): { text: string; count: string | null } {
  if (total <= 1) return { text: 'Buscando precios…', count: null };
  return { text: 'Buscando producto', count: `${Math.max(1, index)} de ${total}` };
}

const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
let lastInputWasKey = false;

export function Dock() {
  const hunt = useHuntProgress();
  const t = useToast();
  const route = useRoute();
  const cart = useStore((s) => s.cart);
  const settings = useStore((s) => s.settings);
  const actionRef = useRef<HTMLButtonElement>(null);

  // Items of the current batch, so the end of the hunt can say what it found.
  const batch = useRef(new Set<string>());
  if (!hunt.active) batch.current.clear();
  else for (const i of cart) if (i.hunt.status === 'queued' || i.hunt.status === 'running') batch.current.add(i.id);

  const finished = hunt.active && !hunt.current && hunt.done >= hunt.total;
  const index = Math.min(hunt.total, hunt.done + (hunt.current ? 1 : 0));
  const outcome = useMemo(() => {
    if (!finished) return null;
    const items = cart.filter((i) => batch.current.has(i.id));
    const unpriced = items.filter((i) => !bestPrice(i, settings)).map((i) => i.product.name);
    return huntOutcomeText(items.length - unpriced.length, unpriced);
  }, [finished, cart, settings]);
  const running = huntRunningText(index, hunt.total);
  const huntLabel = outcome ? outcome.text : running.count ? `${running.text}, ${running.count}` : running.text;

  // Ctrl/Cmd+Z undoes the last action that offers «Deshacer», wherever focus is.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      lastInputWasKey = true;
      if (undoShortcut(e)) e.preventDefault();
    };
    const onPointer = () => {
      lastInputWasKey = false;
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('pointerdown', onPointer, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('pointerdown', onPointer, true);
    };
  }, []);

  // A keyboard user whose focus was lost (the row they removed is gone) lands on «Deshacer».
  useEffect(() => {
    if (!t?.action || !isUndo(t) || !lastInputWasKey) return;
    const f = setTimeout(() => {
      const active = document.activeElement;
      if (!active || active === document.body) actionRef.current?.focus();
    }, 60);
    return () => clearTimeout(f);
  }, [t]);

  const navHidden = !!t?.action && actionPath(t.action) === route.path;
  const showAction = !!t?.action && !navHidden;
  const huntInToast = !!t && hunt.active;
  const overlayOpen = route.params.has('p') || route.params.has('ajustes');

  const huntIcon = (size: number) =>
    !finished ? (
      <span className="spin" aria-hidden="true" />
    ) : outcome?.tone === 'none' ? (
      <Icon name="search" size={size} className="hunt-ico none" aria-hidden="true" />
    ) : (
      <Icon name="check" size={size} className={`hunt-ico ${outcome?.tone ?? 'ok'}`} aria-hidden="true" />
    );

  return (
    <div className={`dock${overlayOpen ? ' over-sheet' : ''}`}>
      <div aria-live="polite" className="sr-only">
        {hunt.active ? (finished ? `Búsqueda terminada. ${outcome?.text ?? ''}` : `${huntLabel}.`) : ''}
      </div>
      <AnimatePresence initial={false}>
        {hunt.active && !huntInToast && (
          <motion.a
            key="hunt"
            href={route.path === '/cesta' ? undefined : hrefFor('/cesta')}
            className={`hunt-pill${outcome ? ` ${outcome.tone}` : ''}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6, transition: { duration: DUR.fast } }}
            transition={{ duration: DUR.slow, ease: EASE_OUT }}
            aria-label={route.path === '/cesta' ? huntLabel : `${huntLabel}. Ver cesta`}
          >
            {huntIcon(18)}
            <span className="txt">{outcome ? outcome.text : running.text}</span>
            {!outcome && running.count && <span className="count">{running.count}</span>}
          </motion.a>
        )}
      </AnimatePresence>
      <div role="status" aria-live="polite" className="toast-slot">
        <AnimatePresence mode="popLayout">
          {t && (
            <motion.div
              key={t.id}
              className={`toast ${t.tone === 'error' ? 'error' : ''}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6, transition: { duration: DUR.fast } }}
              transition={{ duration: DUR.slow, ease: EASE_OUT }}
              onPointerEnter={() => holdToast(true)}
              onPointerLeave={() => holdToast(false)}
              onFocus={() => holdToast(true)}
              onBlur={() => holdToast(false)}
            >
              <span className="text">
                <span>{t.text}</span>
                {huntInToast && (
                  <span className="toast-hunt">
                    {huntIcon(16)}
                    <span className="txt">{outcome ? outcome.text : running.text}</span>
                    {!outcome && running.count && <span className="count">{running.count}</span>}
                  </span>
                )}
              </span>
              {showAction && (
                <button
                  ref={actionRef}
                  type="button"
                  aria-keyshortcuts={isUndo(t) ? 'Control+Z Meta+Z' : undefined}
                  onClick={() => runToastAction(t.id)}
                >
                  {t.action!.label}
                  {isUndo(t) && (
                    <kbd className="kbd" aria-hidden="true">
                      {MAC ? '⌘Z' : 'Ctrl+Z'}
                    </kbd>
                  )}
                </button>
              )}
              <button type="button" className="toast-close" aria-label="Cerrar aviso" onClick={() => dismiss(t.id)}>
                <Icon name="close" size={18} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
