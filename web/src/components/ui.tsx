/** Small UI primitives: stepper, segmented control, switch, info popover, product image, chain dots. */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { ChainId } from '@shared/types';
import { CHAINS } from '@shared/chains';
import { Icon } from './Icon';
import { DUR, EASE_OUT } from '../lib/motion';

// ---------------------------------------------------------------------------
// Stepper (1-99)
// ---------------------------------------------------------------------------

export function Stepper({ value, onChange, label, min = 1, max = 99 }: { value: number; onChange: (n: number) => void; label: string; min?: number; max?: number }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = (raw: string) => {
    const n = Number.parseInt(raw, 10);
    const v = Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : value;
    setDraft(String(v));
    if (v !== value) onChange(v);
  };
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - 1))} disabled={value <= min} aria-label="Quitar uno">
        <Icon name="minus" size={20} />
      </button>
      <input
        inputMode="numeric"
        pattern="[0-9]*"
        aria-label="Cantidad"
        value={draft}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, '').slice(0, 2))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && commit((e.target as HTMLInputElement).value)}
      />
      <button type="button" onClick={() => onChange(Math.min(max, value + 1))} disabled={value >= max} aria-label="Añadir uno">
        <Icon name="plus" size={20} />
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segmented control (radiogroup with a sliding thumb)
// ---------------------------------------------------------------------------

export function Segmented<T extends string | number>({ options, value, onChange, label }: { options: Array<{ value: T; label: ReactNode }>; value: T; onChange: (v: T) => void; label: string }) {
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + options.length) % options.length;
    onChange(options[n]!.value);
    refs.current[n]?.focus();
  };
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {on && <motion.span layoutId={`seg-${id}`} className="seg-thumb" transition={{ duration: DUR.slow, ease: EASE_OUT }} />}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

export function Switch({ checked, onChange, labelledBy }: { checked: boolean; onChange: (v: boolean) => void; labelledBy: string }) {
  return <button type="button" role="switch" className="switch" aria-checked={checked} aria-labelledby={labelledBy} onClick={() => onChange(!checked)} />;
}

// ---------------------------------------------------------------------------
// Info popover (origin-aware: grows from the trigger)
// ---------------------------------------------------------------------------

export function Popover({ trigger, children, label }: { trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-controls': string }) => ReactNode; children: ReactNode; label: string }) {
  const [open, setOpen] = useState(false);
  const [side, setSide] = useState<'left' | 'right'>('left');
  const wrap = useRef<HTMLSpanElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const r = wrap.current?.getBoundingClientRect();
    if (r) setSide(r.left > window.innerWidth / 2 ? 'right' : 'left');
    const onDoc = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <span className="pop-wrap" ref={wrap}>
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-controls': id })}
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="note"
            aria-label={label}
            className="popover"
            style={{ [side]: 0, transformOrigin: `${side === 'left' ? '16px' : 'calc(100% - 16px)'} -8px` }}
            initial={{ opacity: 0, scale: 0.95, y: -4 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, transition: { duration: DUR.fast } }}
            transition={{ duration: DUR.base, ease: EASE_OUT }}
          >
            {children}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Product image with a soft placeholder
// ---------------------------------------------------------------------------

export function ProductImg({ src, alt, size }: { src: string | null; alt: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  if (!src || broken) return <Icon name="image" size={size ?? 36} className="ph" />;
  return <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setBroken(true)} />;
}

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

export function ChainDot({ chain }: { chain: ChainId }) {
  return <span className="chain-dot" style={{ background: CHAINS[chain]?.color ?? '#999' }} aria-hidden="true" />;
}

export function ChainDots({ chains }: { chains: ChainId[] }) {
  const list = [...new Set(chains)];
  if (!list.length) return null;
  const names = list.map((c) => CHAINS[c]?.name ?? c).join(', ');
  return (
    <span className="chain-dots" role="img" aria-label={`Precio en ${names}`} title={names}>
      {list.slice(0, 6).map((c) => (
        <ChainDot key={c} chain={c} />
      ))}
    </span>
  );
}
