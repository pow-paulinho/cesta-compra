import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CHAINS } from '@shared/chains';
import { optimise, type PlanResult, type Stop } from '@shared/optimize';
import { savingTips } from '@shared/tips';
import { formatEuros, formatSize, NBSP } from '@shared/units';
import { Confetti, Ticker } from '../components/feedback';
import { Icon } from '../components/Icon';
import { Cesti } from '../components/Mascot';
import { Popover, Segmented } from '../components/ui';
import { cartSignature, toPlanItems } from '../lib/cart';
import { daysSince, shortDate, STALE_DAYS } from '../lib/format';
import { pendingCount } from '../lib/hunt';
import { DUR, EASE_OUT, stagger } from '../lib/motion';
import { hrefFor } from '../lib/router';
import { newId, setState, updateSettings, useStore, type Cap } from '../lib/store';
import { toast } from '../lib/toast';

const CAPS: Array<{ value: Cap; label: string }> = [
  { value: 1, label: '1' },
  { value: 2, label: '2' },
  { value: 3, label: '3' },
  { value: 0, label: 'Sin límite' },
];

const EXTRA: Array<{ value: number; label: string }> = [0, 100, 200, 300].map((c) => ({ value: c, label: `${c / 100}${NBSP}€` }));

export function PlanScreen() {
  const cart = useStore((s) => s.cart);
  const settings = useStore((s) => s.settings);
  const savings = useStore((s) => s.savings);
  const items = useMemo(() => toPlanItems(cart, settings), [cart, settings]);
  const opt = useMemo(
    () => optimise(items, { ...(settings.cap ? { cap: settings.cap } : {}), extraStoreCents: settings.extraStoreCents, chains: settings.chains }),
    [items, settings.cap, settings.extraStoreCents, settings.chains],
  );
  const tips = useMemo(() => savingTips(items, opt), [items, opt]);
  const pending = pendingCount(cart);
  const plan = opt.split;
  const saving = opt.savingCents != null && opt.savingCents > 0 ? opt.savingCents : 0;
  const signature = cartSignature(cart);
  const logged = savings.some((s) => s.signature === signature);

  // Celebrate when a saving appears or grows (not on every re-render).
  const [fire, setFire] = useState(0);
  const lastSaving = useRef(0);
  useEffect(() => {
    if (saving > lastSaving.current && pending === 0) setFire((f) => f + 1);
    lastSaving.current = saving;
  }, [saving, pending]);

  if (!cart.length) {
    return (
      <div className="empty" style={{ paddingTop: 48 }}>
        <Cesti mood="idle" size={110} />
        <h1>Aún no hay plan</h1>
        <p>Añade algunos productos a tu cesta y te diremos dónde comprar cada uno para gastar menos.</p>
        <a className="btn btn-primary" href={hrefFor('/buscar')}>
          Buscar productos
        </a>
      </div>
    );
  }

  const names = new Map(cart.map((i) => [i.id, i.product.name]));
  const bestSingle = opt.bestSingle;
  const pct = bestSingle && saving ? Math.round((saving / bestSingle.totalCents) * 100) : 0;
  const mood = saving > 0 ? 'celebrate' : plan.stops.length ? 'happy' : 'sad';

  const logSaving = () => {
    setState((s) => ({
      ...s,
      savings: [...s.savings, { id: newId(), date: new Date().toISOString().slice(0, 10), cents: saving, stores: plan.stores, signature }],
    }));
    toast({ text: `¡Apuntado! Llevas ${formatEuros(savings.reduce((a, b) => a + b.cents, 0) + saving)} ahorrados.`, tone: 'success' });
  };

  return (
    <div className="screen">
      <Confetti fire={fire} />
      <h1>Tu mejor compra</h1>

      {pending > 0 && (
        <div className="notice warn" role="status">
          <Icon name="clock" />
          <span>
            Aún buscamos {pending} {pending === 1 ? 'producto' : 'productos'}. El plan se recalcula solo en cuanto lleguen los precios.
          </span>
        </div>
      )}

      <div className="plan-controls">
        <div className="field">
          <span className="label" id="cap-l">
            ¿A cuántas tiendas quieres ir?
          </span>
          <Segmented<Cap> label="Número máximo de tiendas" value={settings.cap} onChange={(cap) => updateSettings({ cap })} options={CAPS} />
        </div>
        <div className="field">
          <span className="label row" id="extra-l" style={{ gap: 4 }}>
            ¿Cuánto te cuesta ir a otra tienda?
            <Popover
              label="Coste por tienda extra"
              trigger={(props) => (
                <button type="button" className="icon-btn" aria-label="¿Para qué sirve?" style={{ width: 32, height: 32 }} {...props}>
                  <Icon name="info" size={18} />
                </button>
              )}
            >
              Tiempo, gasolina o transporte. Sumamos este coste por cada parada de más y solo te proponemos repartir la compra si el ahorro lo compensa.
            </Popover>
          </span>
          <Segmented<number> label="Coste por cada tienda extra" value={settings.extraStoreCents} onChange={(extraStoreCents) => updateSettings({ extraStoreCents })} options={EXTRA} />
        </div>
      </div>

      <motion.section className="plan-hero" aria-labelledby="hero-l" layout transition={{ duration: DUR.slow, ease: EASE_OUT }}>
        <Cesti mood={mood} size={84} />
        <div style={{ minWidth: 0 }}>
          <div className="label" id="hero-l">
            {plan.stores <= 1 ? 'Todo en una tienda' : `Repartido en ${plan.stores} tiendas`}
          </div>
          <div className="big">
            <Ticker cents={plan.totalCents} />
          </div>
          <div style={{ fontWeight: 800, marginTop: 4 }} className="muted">
            {plan.stops.map((s) => CHAINS[s.chain]?.name).join(' + ') || 'Sin precios todavía'}
          </div>
        </div>
      </motion.section>

      <Comparison bestSingle={bestSingle} plan={plan} saving={saving} pct={pct} />

      {saving > 0 && (
        <button type="button" className="btn btn-secondary btn-block" onClick={logSaving} disabled={logged}>
          {logged ? '✓ Ahorro apuntado' : `Lo compro así · apuntar ${formatEuros(saving)}`}
        </button>
      )}

      {plan.missing.length > 0 && (
        <div className="notice warn">
          <Icon name="warn" />
          <div>
            <b>Sin precio en tus súper:</b> {plan.missing.map((id) => names.get(id) ?? id).join(', ')}.
            <p style={{ fontWeight: 650, marginTop: 4 }}>
              Prueba «Me vale otra marca» en su ficha, activa más súper en Ajustes o añade tu clave de búsqueda en vivo.
            </p>
          </div>
        </div>
      )}

      <section aria-labelledby="stops-h">
        <h2 id="stops-h" className="section-title" style={{ marginBottom: 10 }}>
          Dónde comprar cada cosa
        </h2>
        <div className="tickets">
          <AnimatePresence mode="popLayout" initial={false}>
            {plan.stops.map((s, i) => (
              <Ticket key={s.chain} stop={s} index={i} />
            ))}
          </AnimatePresence>
        </div>
      </section>

      {tips.length > 0 && (
        <section aria-labelledby="tips-h">
          <h2 id="tips-h" className="section-title" style={{ marginBottom: 10 }}>
            Consejos para ahorrar
          </h2>
          <ul className="tips">
            {tips.map((t, i) => (
              <motion.li
                key={t.id}
                className="card tip"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: DUR.slow, ease: EASE_OUT, delay: stagger(i) }}
              >
                <span className="ico" aria-hidden="true">
                  {t.icon}
                </span>
                <div>
                  <b>{t.title}</b>
                  <p>{t.body}</p>
                </div>
              </motion.li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function Comparison({ bestSingle, plan, saving, pct }: { bestSingle: (PlanResult & { chain: keyof typeof CHAINS }) | null; plan: PlanResult; saving: number; pct: number }) {
  if (!bestSingle) {
    return (
      <div className="notice">
        <Icon name="info" />
        <span>Ningún súper tiene todos tus productos, así que no podemos compararlo con hacer toda la compra en uno.</span>
      </div>
    );
  }
  const single = CHAINS[bestSingle.chain]?.name ?? bestSingle.chain;
  return (
    <div className="compare">
      <div className="card">
        <div className="muted" style={{ fontWeight: 800, fontSize: '0.85rem' }}>
          Todo en {single}
        </div>
        <div className="v">{formatEuros(bestSingle.totalCents)}</div>
      </div>
      <div className="card" style={saving ? { borderColor: 'var(--green)' } : undefined}>
        <div className="muted" style={{ fontWeight: 800, fontSize: '0.85rem' }}>
          {plan.stores > 1 ? 'Repartido' : 'Tu plan'}
        </div>
        <div className="v">{formatEuros(plan.totalCents)}</div>
      </div>
      <AnimatePresence initial={false} mode="wait">
        {saving > 0 ? (
          <motion.div
            key="save"
            className="save"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.base, ease: EASE_OUT }}
          >
            🎉 Ahorras {formatEuros(saving)} ({pct}{NBSP}%) frente a hacerlo todo en {single}.
          </motion.div>
        ) : (
          <motion.div key="nosave" className="save" style={{ background: 'var(--soft)', color: 'var(--ink)' }} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            Lo más barato es hacer toda la compra en {single}. ¡Una sola parada!
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Ticket({ stop, index }: { stop: Stop; index: number }) {
  const c = CHAINS[stop.chain];
  return (
    <motion.article
      layout
      className="ticket"
      aria-label={`${c?.name}: ${formatEuros(stop.totalCents)}`}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: DUR.slow, ease: EASE_OUT, delay: stagger(index) }}
    >
      <header>
        <span className="store" style={{ background: c?.color }} aria-hidden="true">
          {c?.short}
        </span>
        <div style={{ flex: 1 }}>
          <h3>{c?.name}</h3>
          <span className="muted" style={{ fontSize: '0.85rem', fontWeight: 700 }}>
            {stop.lines.length} {stop.lines.length === 1 ? 'producto' : 'productos'}
          </span>
        </div>
      </header>
      <ul>
        {stop.lines.map((l) => (
          <li key={l.itemId}>
            <span className="ln">{l.offer.name}</span>
            <span className="lc">{formatEuros(l.costCents)}</span>
            <span className="ld">
              <span>
                {l.packs} × {formatEuros(l.offer.priceCents)}
                {l.offer.sizeText ? ` · ${l.offer.sizeText}` : ''}
              </span>
              {l.offer.source === 'live' && <span className="tag live">en vivo</span>}
              {l.offer.source === 'demo' && <span className="tag demo">demo</span>}
              {l.offer.source === 'open_prices' && (
                <span className={`tag ${daysSince(l.offer.observedOn) > STALE_DAYS ? 'old' : ''}`}>
                  {daysSince(l.offer.observedOn) > STALE_DAYS ? 'antiguo · ' : ''}
                  {shortDate(l.offer.observedOn)}
                </span>
              )}
              {l.offer.promo && <span className="tag promo">{l.offer.promo}</span>}
              {l.leftover && <span>te sobran {formatSize(l.leftover)}</span>}
            </span>
          </li>
        ))}
      </ul>
      <footer>
        <span>Total</span>
        <span>{formatEuros(stop.totalCents)}</span>
      </footer>
    </motion.article>
  );
}
