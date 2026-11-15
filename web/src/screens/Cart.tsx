import { useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Candidate, ChainId, MatchKind } from '@shared/types';
import { CHAINS } from '@shared/chains';
import { costFor, wantedSize } from '@shared/equiv';
import { formatEuros } from '@shared/units';
import { Icon } from '../components/Icon';
import { Cesti } from '../components/Mascot';
import { ChainDot, Popover, ProductImg, Stepper } from '../components/ui';
import { bestPrice, chainOffer, wantedOf } from '../lib/cart';
import { unitPriceLabel } from '../lib/format';
import { cancel, enqueue, forget, pendingCount } from '../lib/hunt';
import { DUR, EASE_OUT } from '../lib/motion';
import { hrefFor, navigate } from '../lib/router';
import { clampQty, getState, setState, updateItem, useStore, type CartItem, type ChainHunt, type Settings } from '../lib/store';
import { toast } from '../lib/toast';

export function CartScreen() {
  const cart = useStore((s) => s.cart);
  const settings = useStore((s) => s.settings);
  const pending = pendingCount(cart);
  const total = useMemo(() => cart.reduce((sum, i) => sum + (bestPrice(i, settings)?.cents ?? 0), 0), [cart, settings]);
  const priced = cart.filter((i) => bestPrice(i, settings)).length;

  const remove = (item: CartItem) => {
    const index = getState().cart.findIndex((i) => i.id === item.id);
    forget(item.id);
    setState((s) => ({ ...s, cart: s.cart.filter((i) => i.id !== item.id) }));
    toast({
      text: `Quitado: ${item.product.name}`,
      action: {
        label: 'Deshacer',
        run: () => {
          setState((s) => {
            const cart = s.cart.slice();
            cart.splice(Math.min(index, cart.length), 0, item);
            return { ...s, cart };
          });
          if (item.hunt.status === 'queued' || item.hunt.status === 'running') enqueue(item.id);
        },
      },
    });
  };

  if (!cart.length) {
    return (
      <div className="empty" style={{ paddingTop: 48 }}>
        <Cesti mood="idle" size={110} />
        <h1>Tu cesta está vacía</h1>
        <p>Busca un producto, ábrelo y pulsa «Añadir y buscar en los súper». Nosotros miramos los precios mientras sigues a lo tuyo.</p>
        <a className="btn btn-primary" href={hrefFor('/buscar')}>
          Buscar productos
        </a>
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <h1>Tu cesta</h1>
        <span className="muted" style={{ fontWeight: 800 }}>
          {cart.length} {cart.length === 1 ? 'producto' : 'productos'}
          {pending > 0 && ` · buscando ${pending}`}
        </span>
      </div>

      <motion.ul className="cart-list" layout>
        <AnimatePresence initial={false} mode="popLayout">
          {cart.map((item) => (
            <CartRow key={item.id} item={item} settings={settings} onRemove={() => remove(item)} />
          ))}
        </AnimatePresence>
      </motion.ul>

      <motion.div layout className="card summary" transition={{ duration: DUR.slow, ease: EASE_OUT }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="muted" style={{ fontWeight: 800, fontSize: '0.85rem' }}>
            Suma de los mejores precios{priced < cart.length ? ` (${priced} de ${cart.length} con precio)` : ''}
          </div>
          <div className="total">{formatEuros(total)}</div>
        </div>
      </motion.div>
      <motion.div layout transition={{ duration: DUR.slow, ease: EASE_OUT }}>
        <button type="button" className="btn btn-primary btn-block" onClick={() => navigate('/plan')}>
          Ver mi mejor compra <Icon name="arrow" />
        </button>
        {pending > 0 && (
          <p className="muted" style={{ textAlign: 'center', fontWeight: 700, fontSize: '0.9rem', marginTop: 6 }}>
            Aún buscamos {pending} {pending === 1 ? 'producto' : 'productos'}; el plan se actualiza solo.
          </p>
        )}
      </motion.div>
    </div>
  );
}

const KIND_LABEL: Record<MatchKind, string> = {
  exact: 'Mismo producto',
  'same-brand': 'Misma marca',
  equivalent: 'Equivalente',
  weak: 'Parecido',
};

function huntLine(item: CartItem): string {
  switch (item.hunt.status) {
    case 'queued':
      return 'En cola para buscar…';
    case 'running': {
      const all = Object.values(item.hunt.chains);
      const done = all.filter((h) => h && h.status !== 'pending').length;
      return `Buscando en los súper… ${done}/${all.length}`;
    }
    case 'cancelled':
      return 'Búsqueda cancelada.';
    case 'error':
      return item.hunt.error ?? 'La búsqueda ha fallado.';
    default:
      return '';
  }
}

function CartRow({ item, settings, onRemove }: { item: CartItem; settings: Settings; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const best = bestPrice(item, settings);
  const busy = item.hunt.status === 'queued' || item.hunt.status === 'running';
  const meta = [item.product.brand, item.product.sizeText].filter(Boolean).join(' · ');
  const chains = settings.chains.filter((c) => item.hunt.chains[c] || item.product.offers.some((o) => o.chain === c));
  const line = huntLine(item);

  return (
    <motion.li
      layout
      className="card citem"
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: DUR.base, ease: EASE_OUT } }}
      transition={{ duration: DUR.slow, ease: EASE_OUT }}
    >
      <div className="citem-top">
        <div className="thumb">
          <ProductImg src={item.product.image} alt="" size={28} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="title">{item.product.name}</div>
              <div className="sub">
                {meta}
                {meta ? ' · ' : ''}
                {item.mode === 'exact' ? 'este producto' : 'vale otra marca'}
              </div>
            </div>
            <button type="button" className="icon-btn" onClick={onRemove} aria-label={`Quitar ${item.product.name}`} style={{ marginTop: -8, marginRight: -6 }}>
              <Icon name="trash" size={20} />
            </button>
          </div>
        </div>
      </div>

      <div className="citem-row">
        <Stepper value={item.qty} onChange={(n) => updateItem(item.id, (i) => ({ ...i, qty: clampQty(n) }))} label={`Cantidad de ${item.product.name}`} />
        <div className="best" style={{ flex: 1, minWidth: 140 }} aria-live="polite">
          {best ? (
            <>
              Mejor: <b>{formatEuros(best.cents)}</b> en {CHAINS[best.chain]?.name}
              {best.packs !== item.qty && (
                <span className="muted" style={{ display: 'block', fontSize: '0.8rem' }}>
                  {best.packs} {best.packs === 1 ? 'envase' : 'envases'} de {best.offer.sizeText ?? '—'}
                </span>
              )}
            </>
          ) : busy ? (
            <span className="muted">Buscando el mejor precio…</span>
          ) : (
            <span className="muted">Sin precio en tus súper</span>
          )}
        </div>
      </div>

      <div className="cchips" aria-label={`Precio en cada súper de ${item.product.name}`}>
        <AnimatePresence initial={false}>
          {chains.map((c) => (
            <ChainChip key={c} chain={c} item={item} settings={settings} isBest={best?.chain === c} />
          ))}
        </AnimatePresence>
      </div>

      {(line || item.hunt.status !== 'done') && (
        <div className="row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
          <span className={item.hunt.status === 'error' ? 'field-error' : 'muted'} style={{ fontWeight: 700, fontSize: '0.88rem', flex: 1, minWidth: 160 }}>
            {line}
          </span>
          {busy ? (
            <button type="button" className="btn btn-ghost btn-small" onClick={() => cancel(item.id)}>
              Cancelar búsqueda
            </button>
          ) : item.hunt.status !== 'done' ? (
            <button type="button" className="btn btn-secondary btn-small" onClick={() => enqueue(item.id)}>
              <Icon name="refresh" size={18} /> Volver a buscar
            </button>
          ) : null}
        </div>
      )}

      {item.hunt.status === 'done' && (
        <button type="button" className="btn btn-ghost btn-small" style={{ marginTop: 6, paddingLeft: 0 }} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? 'Ocultar opciones' : 'Ver opciones de cada súper'}
          <Icon name="chevron" size={18} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 200ms var(--ease-out)' }} />
        </button>
      )}
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="options"
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6, transition: { duration: DUR.fast } }}
            transition={{ duration: DUR.base, ease: EASE_OUT }}
          >
            {chains.map((c) => (
              <Options key={c} chain={c} item={item} hunt={item.hunt.chains[c]} settings={settings} />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

function ChainChip({ chain, item, settings, isBest }: { chain: ChainId; item: CartItem; settings: Settings; isBest: boolean }) {
  const h = item.hunt.chains[chain];
  const status = h?.status ?? 'pending';
  // No hunt answer yet: the price known from the search, if any. A locked chain may carry the
  // catalogue's prices (the server sends them as candidates), and the plan counts them.
  const offer = !h || status === 'ok' || status === 'none' || status === 'locked' ? chainOffer(item, chain, settings) : null;
  const name = CHAINS[chain]?.name ?? chain;
  const cost = offer ? costFor(offer, wantedSize(wantedOf(item)), item.qty).cents : null;

  let cls = 'cchip';
  let state: React.ReactNode;
  let label: string;
  if (h?.status === 'pending') {
    cls += ' pending';
    state = <span className="spin" aria-hidden="true" />;
    label = `${name}: buscando`;
  } else if (offer && cost != null) {
    cls += isBest ? ' pick' : ' ok';
    state = status === 'locked' ? '🔒' : <ChainDot chain={chain} />;
    label = `${name}: ${formatEuros(cost)}${isBest ? ', el más barato' : ''}${status === 'locked' ? ', precio del catálogo' : ''}`;
  } else if (status === 'locked') {
    cls += ' locked';
    state = '🔒';
    label = `${name}: necesita tu clave en vivo`;
  } else if (status === 'none' || (!h && !offer)) {
    cls += ' none';
    state = <Icon name="x" size={14} />;
    label = `${name}: no lo tiene`;
  } else {
    cls += ' bad';
    state = '⚠';
    label = `${name}: ${h?.reason ?? 'no disponible'}`;
  }

  const chip = (
    <motion.span
      layout="position"
      className={cls}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ duration: DUR.base, ease: EASE_OUT }}
      aria-label={label}
      role="img"
    >
      <span className="state" aria-hidden="true">
        {state}
      </span>
      <span aria-hidden="true">{name}</span>
      <AnimatePresence mode="popLayout" initial={false}>
        {cost != null && (
          <motion.span
            key={cost}
            aria-hidden="true"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: DUR.base, ease: EASE_OUT }}
          >
            {formatEuros(cost)}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.span>
  );

  if (h && h.reason && (status === 'locked' || status === 'blocked' || status === 'unavailable' || status === 'error')) {
    return (
      <Popover
        label={`Sobre ${name}`}
        trigger={(props) => (
          <button type="button" {...props} aria-label={`${label}. Más información`} style={{ display: 'inline-flex' }}>
            {chip}
          </button>
        )}
      >
        {h.reason}
      </Popover>
    );
  }
  return chip;
}

function Options({ chain, item, hunt, settings }: { chain: ChainId; item: CartItem; hunt: ChainHunt | undefined; settings: Settings }) {
  const name = CHAINS[chain]?.name ?? chain;
  const size = wantedSize(wantedOf(item));
  const current = chainOffer(item, chain, settings);
  const chosen = item.choice[chain];
  const choose = (id: string | null) =>
    updateItem(item.id, (i) => {
      const choice = { ...i.choice };
      if (id) choice[chain] = id;
      else delete choice[chain];
      return { ...i, choice };
    });

  // Any answer with candidates can be chosen from (a locked chain may carry catalogue prices).
  if (!hunt || hunt.status === 'pending' || !hunt.candidates.length) {
    const why = hunt?.reason ?? (hunt?.status === 'locked' ? 'Necesita tu clave de búsqueda en vivo (Ajustes).' : 'No tiene este producto.');
    return (
      <div className="opt-chain">
        <h4>
          <ChainDot chain={chain} /> {name}
        </h4>
        <p className="muted" style={{ fontSize: '0.88rem', fontWeight: 700 }}>
          {why}
        </p>
      </div>
    );
  }

  return (
    <div className="opt-chain" role="radiogroup" aria-label={`Opciones en ${name}`}>
      <h4>
        <ChainDot chain={chain} /> {name}
        {chosen && (
          <button type="button" className="btn btn-ghost btn-small" style={{ marginLeft: 'auto', minHeight: 32 }} onClick={() => choose(null)}>
            Elegir automático
          </button>
        )}
      </h4>
      {hunt.status !== 'ok' && hunt.reason && (
        <p className="muted" style={{ fontSize: '0.88rem', fontWeight: 700 }}>
          {hunt.reason}
        </p>
      )}
      <div className="opt-list">
        {hunt.candidates.map((c: Candidate) => {
          const on = current?.id === c.id && current.chain === c.chain;
          const cost = costFor(c, size, item.qty);
          const unit = unitPriceLabel(c);
          return (
            <button key={c.id} type="button" role="radio" aria-checked={on} className="opt" onClick={() => choose(c.id)}>
              {c.image ? <img src={c.image} alt="" /> : <span className="ph" />}
              <span style={{ minWidth: 0 }}>
                <span className="n" style={{ display: 'block' }}>
                  {c.name}
                </span>
                <span className="k">
                  {KIND_LABEL[c.kind]}
                  {c.sizeText ? ` · ${c.sizeText}` : ''}
                  {unit ? ` · ${unit}` : ''}
                  {c.source === 'demo' ? ' · demo' : c.source === 'open_prices' ? ' · Open Prices' : ''}
                </span>
              </span>
              <span className="p">
                {formatEuros(cost.cents)}
                {cost.packs !== item.qty && (
                  <span className="k" style={{ display: 'block' }}>
                    {cost.packs} × {formatEuros(c.priceCents)}
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      {hunt.candidates.length > 0 && (
        <Popover
          label="Tipos de coincidencia"
          trigger={(props) => (
            <button type="button" className="btn btn-ghost btn-small" style={{ paddingLeft: 0 }} {...props}>
              <Icon name="info" size={18} /> ¿Qué significa cada tipo?
            </button>
          )}
        >
          <b>Mismo producto</b>: mismo código de barras o mismo nombre. <b>Misma marca</b>: variante de la marca. <b>Equivalente</b>: otra marca del mismo tipo y
          tamaño parecido. <b>Parecido</b>: no estamos seguros; revísalo antes de elegirlo.
        </Popover>
      )}
    </div>
  );
}
