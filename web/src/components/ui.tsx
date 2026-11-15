/** Small UI primitives: stepper, segmented control, switch, info popover, product image, chain dots. */
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { ChainId } from '@shared/types';
import { CHAINS } from '@shared/chains';
import { Icon } from './Icon';
import { DUR, EASE_OUT } from '../lib/motion';
import { commitQty, placePopover, qtyDraft, qtyHintText, stepKey, unitsLabel, takeWithMore, type PopoverPlacement } from './ui-logic';

// ---------------------------------------------------------------------------
// Stepper (1-99)
// ---------------------------------------------------------------------------

export function Stepper({ value, onChange, label, min = 1, max = 99 }: { value: number; onChange: (n: number) => void; label: string; min?: number; max?: number }) {
  const [draft, setDraft] = useState(String(value));
  const [hint, setHint] = useState<{ text: string; n: number } | null>(null);
  const [said, setSaid] = useState('');
  const pressed = useRef(false);
  const hintId = useId();
  // A repeated message gets a trailing no-break space so the live region still reads it out.
  const announce = (t: string) => setSaid((prev) => (prev === t ? `${t}\u00a0` : t));
  useEffect(() => setDraft(String(value)), [value]);
  // Announce the new value after a +/- press or a spin key, so focus can stay where it is.
  useEffect(() => {
    if (!pressed.current) return;
    pressed.current = false;
    announce(unitsLabel(value));
  }, [value]);
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 2600);
    return () => clearTimeout(t);
  }, [hint]);
  const set = (n: number) => {
    if (n === value) return;
    pressed.current = true;
    setHint(null);
    onChange(n);
  };
  const commit = (raw: string) => {
    const r = commitQty(raw, value, min, max);
    setDraft(String(r.value));
    if (r.hint) {
      const text = qtyHintText(r.hint, min, max);
      setHint((h) => ({ text, n: (h?.n ?? 0) + 1 }));
      announce(text);
    }
    if (r.value !== value) onChange(r.value);
  };
  return (
    <div className="stepper" role="group" aria-label={label}>
      <button type="button" onClick={() => set(Math.max(min, value - 1))} disabled={value <= min} aria-label="Quitar uno">
        <Icon name="minus" size={20} />
      </button>
      <input
        inputMode="numeric"
        pattern="[0-9]*"
        role="spinbutton"
        aria-label="Cantidad"
        aria-valuenow={value}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuetext={unitsLabel(value)}
        aria-describedby={hint ? hintId : undefined}
        value={draft}
        onChange={(e) => setDraft(qtyDraft(e.target.value))}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') return commit(e.currentTarget.value);
          const n = stepKey(e.key, value, min, max);
          if (n === null) return;
          e.preventDefault();
          set(n);
        }}
      />
      <button type="button" onClick={() => set(Math.min(max, value + 1))} disabled={value >= max} aria-label="Añadir uno">
        <Icon name="plus" size={20} />
      </button>
      <span className="sr-only" aria-live="polite">
        {said}
      </span>
      <AnimatePresence>
        {hint && (
          <motion.span
            key={hint.n}
            id={hintId}
            className="stepper-hint"
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, transition: { duration: DUR.fast } }}
            transition={{ duration: DUR.base, ease: EASE_OUT }}
          >
            {hint.text}
          </motion.span>
        )}
      </AnimatePresence>
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
  const [place, setPlace] = useState<PopoverPlacement | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const id = useId();
  const measure = () => {
    const r = wrap.current?.getBoundingClientRect();
    if (r) setPlace(placePopover(r.left, r.width, document.documentElement.clientWidth || window.innerWidth));
  };
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    // Capture phase, and claimed: Escape closes only the popover, not the sheet it sits in.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
      wrap.current?.querySelector<HTMLElement>('button, [href], [tabindex]')?.focus({ preventScroll: true });
    };
    document.addEventListener('pointerdown', onDoc);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', measure);
    return () => {
      document.removeEventListener('pointerdown', onDoc);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', measure);
    };
  }, [open]);
  const toggle = () => {
    if (!open) measure();
    setOpen((o) => !o);
  };
  return (
    <span className="pop-wrap" ref={wrap}>
      {trigger({ onClick: toggle, 'aria-expanded': open, 'aria-controls': id })}
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="note"
            aria-label={label}
            className="popover"
            style={place ? { left: place.offset, width: place.width, transformOrigin: `${place.originX}px -8px` } : { left: 0 }}
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

/**
 * The chains that sell a product as short labels ("Li", "Su", "+2"), in the order given
 * (cheapest first on the cards). Decorative: the card's own label names the chains.
 */
export function ChainTags({ chains, limit = 3 }: { chains: ChainId[]; limit?: number }) {
  const list = [...new Set(chains)];
  if (!list.length) return null;
  const { shown, more } = takeWithMore(list, limit);
  return (
    <span className="chain-tags" aria-hidden="true">
      {shown.map((c) => (
        <span key={c} className="ctag" style={{ '--c': CHAINS[c]?.color ?? '#999' } as CSSProperties}>
          {CHAINS[c]?.short ?? c}
        </span>
      ))}
      {more > 0 && <span className="ctag more">+{more}</span>}
    </span>
  );
}
