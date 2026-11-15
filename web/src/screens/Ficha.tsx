import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { HuntMode, Offer, Product, ProductDetails } from '@shared/types';
import { CHAINS } from '@shared/chains';
import { formatEuros } from '@shared/units';
import { Ticker } from '../components/feedback';
import { Icon } from '../components/Icon';
import { cheapest } from '../components/ProductCard';
import { useSheetDrag } from '../components/Sheet';
import { ChainDot, Popover, ProductImg, Segmented, Stepper } from '../components/ui';
import { Cesti } from '../components/Mascot';
import { isEan } from '../lib/api';
import { countsInMode } from '../lib/cart';
import { daysSince, shortDate, STALE_DAYS, unitPriceLabel } from '../lib/format';
import { enqueue } from '../lib/hunt';
import { DUR, EASE_OUT } from '../lib/motion';
import { loadDetails, useProduct } from '../lib/products';
import { closeOverlay, hrefFor } from '../lib/router';
import { getState, newId, setState, useStore, type CartItem } from '../lib/store';
import { toast } from '../lib/toast';

const MODE_HELP: Record<HuntMode, string> = {
  exact: 'Buscaremos este mismo producto (misma marca y tamaño) en cada súper.',
  equivalent: 'Buscaremos el más barato que sirva igual: otra marca o marca blanca, mismo tipo y tamaño parecido.',
};

export function Ficha({ productKey }: { productKey: string }) {
  // Live view of the product: offers that reach the search after the sheet opened still show up.
  const seen = useProduct(productKey);
  // Opened from the cart after a reload: the cart keeps its own copy.
  const fromCart = useStore((s) => s.cart.find((i) => i.product.key === productKey)?.product);
  const product = useMemo<Product | null>(() => seen ?? (fromCart ? { ...fromCart } : null), [seen, fromCart]);
  if (!product) {
    return (
      <div className="empty">
        <Cesti mood="sad" size={88} />
        <h2>No encontramos este producto</h2>
        <p>Puede que la página se haya recargado. Vuelve a buscarlo y ábrelo de nuevo.</p>
        <button type="button" className="btn btn-secondary" onClick={closeOverlay}>
          Volver
        </button>
      </div>
    );
  }
  return <FichaBody product={product} />;
}

function sourceTags(o: Offer) {
  if (o.source === 'live') return [<span key="s" className="tag live">en vivo</span>];
  if (o.source === 'demo') return [<span key="s" className="tag demo">demo</span>];
  const tags = [<span key="s" className="tag">Open Prices · {shortDate(o.observedOn)}</span>];
  if (daysSince(o.observedOn) > STALE_DAYS) tags.push(<span key="o" className="tag old">antiguo</span>);
  return tags;
}

function FichaBody({ product: p }: { product: Product }) {
  const demo = useStore((s) => s.settings.demo);
  const inCart = useStore((s) => s.cart.find((i) => i.product.key === p.key));
  const [qty, setQty] = useState(inCart?.qty ?? 1);
  const [mode, setMode] = useState<HuntMode>(inCart?.mode ?? 'exact');
  const drag = useSheetDrag();

  // One offer per chain (the cheapest known), cheapest first; demo and real prices never mix.
  const offers = useMemo(() => {
    const byChain = new Map<string, Offer>();
    for (const o of p.offers) {
      if (!(o.priceCents > 0) || !countsInMode(o, demo)) continue;
      const prev = byChain.get(o.chain);
      if (!prev || o.priceCents < prev.priceCents) byChain.set(o.chain, o);
    }
    return [...byChain.values()].sort((a, b) => a.priceCents - b.priceCents);
  }, [p.offers, demo]);
  const best = cheapest(offers);
  const worst = offers[offers.length - 1];
  const unit = best ? unitPriceLabel(best) : null;
  const meta = [p.brand, p.sizeText].filter(Boolean).join(' · ');

  const add = () => {
    const existing = getState().cart.find((i) => i.product.key === p.key);
    if (existing) {
      const modeChanged = existing.mode !== mode;
      setState((s) => ({ ...s, cart: s.cart.map((i) => (i.id === existing.id ? { ...i, qty, mode } : i)) }));
      if (modeChanged || existing.hunt.status === 'error' || existing.hunt.status === 'cancelled') enqueue(existing.id);
      toast({ text: `Actualizado en tu cesta: ${qty} ${qty === 1 ? 'unidad' : 'unidades'}.`, tone: 'success', action: { label: 'Ver cesta', run: () => (location.hash = hrefFor('/cesta')) } });
    } else {
      const item: CartItem = {
        id: newId(),
        product: { key: p.key, name: p.name, brand: p.brand, sizeText: p.sizeText, ean: p.ean, image: p.image, offers: p.offers },
        qty,
        mode,
        hunt: { status: 'queued', chains: {}, queuedAt: Date.now() },
        choice: {},
        addedAt: Date.now(),
      };
      setState((s) => ({ ...s, cart: [...s.cart, item] }));
      enqueue(item.id);
      toast({ text: 'Añadido. Lo estamos buscando en los súper…', tone: 'success', action: { label: 'Ver cesta', run: () => (location.hash = hrefFor('/cesta')) } });
    }
    closeOverlay();
  };

  return (
    <article className="ficha" aria-labelledby="ficha-title">
      <div className="ficha-photo" onPointerDown={drag}>
        <ProductImg src={p.image} alt={p.name} size={64} />
      </div>

      <header className="ficha-title">
        <h1 id="ficha-title" style={{ fontSize: '1.6rem', paddingRight: 36 }}>
          {p.name}
        </h1>
        {meta && <p className="brand-line">{meta}</p>}
      </header>

      <div className="ficha-price">
        {best ? (
          <>
            <span className="big">
              Desde <Ticker cents={best.priceCents} duration={0.4} />
            </span>
            <span className="muted" style={{ fontWeight: 800 }}>
              en {CHAINS[best.chain]?.name ?? best.chain}
            </span>
            {unit && <span className="unit-pill">{unit}</span>}
            {worst && worst !== best && (
              <span className="muted" style={{ width: '100%', fontWeight: 700, fontSize: '0.92rem' }}>
                Hasta {formatEuros(worst.priceCents)} en {CHAINS[worst.chain]?.name}: hay {formatEuros(worst.priceCents - best.priceCents)} de diferencia.
              </span>
            )}
          </>
        ) : (
          <p className="notice" style={{ width: '100%' }}>
            <Icon name="info" /> Aún no tenemos precios de este producto. Añádelo y lo buscamos en los súper.
          </p>
        )}
      </div>

      <section className="controls" aria-label="Añadir a la cesta">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="label" id="qty-label">
            Cantidad
          </span>
          <Stepper value={qty} onChange={setQty} label="Cantidad" />
        </div>
        <Segmented<HuntMode>
          label="Qué buscar"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'exact', label: 'Este producto' },
            { value: 'equivalent', label: 'Me vale otra marca' },
          ]}
        />
        <AnimatePresence mode="wait" initial={false}>
          <motion.p
            key={mode}
            className="explain"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DUR.fast, ease: EASE_OUT }}
          >
            {MODE_HELP[mode]}
          </motion.p>
        </AnimatePresence>
        <button type="button" className="btn btn-primary btn-block" onClick={add}>
          {inCart ? 'Actualizar y buscar' : 'Añadir y buscar en los súper'}
        </button>
      </section>

      {offers.length > 0 && (
        <section className="full" aria-labelledby="prices-h">
          <div className="section-title" style={{ marginBottom: 8 }}>
            <h2 id="prices-h" style={{ font: 'inherit' }}>
              Precios que conocemos
            </h2>
            <Popover
              label="Sobre los precios"
              trigger={(props) => (
                <button type="button" className="icon-btn" aria-label="¿De dónde salen los precios?" {...props}>
                  <Icon name="info" size={20} />
                </button>
              )}
            >
              <b>En vivo</b>: consultado ahora en la web del súper. <b>Open Prices</b>: precio compartido por la comunidad en esa fecha;
              si tiene más de {STALE_DAYS} días lo marcamos como antiguo. <b>Demo</b>: precio de ejemplo{demo ? ' (tienes los precios demo activados)' : ''}.
            </Popover>
          </div>
          <ul className="price-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            <AnimatePresence initial={false}>
              {offers.map((o) => (
                <motion.li
                  key={`${o.chain}-${o.id}`}
                  layout="position"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: DUR.base, ease: EASE_OUT }}
                  className={`price-row ${o === best && offers.length > 1 ? 'best' : ''}`}
                >
                  <ChainDot chain={o.chain} />
                  <span className="who">
                    <b>{CHAINS[o.chain]?.name ?? o.chain}</b>
                    <span className="tags">
                      {sourceTags(o)}
                      {o.promo && <span className="tag promo">{o.promo}</span>}
                    </span>
                  </span>
                  <span className="amount">
                    {formatEuros(o.priceCents)}
                    <span className="unit" style={{ display: 'block' }}>
                      {unitPriceLabel(o) ?? ''}
                    </span>
                  </span>
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </section>
      )}

      {isEan(p.ean) && <Details ean={p.ean} initial={p.details} />}
    </article>
  );
}

const NUTRI_COLORS: Record<string, string> = { a: '#038141', b: '#85BB2F', c: '#E6A100', d: '#EE8100', e: '#E63E11' };

/** Search cards carry only a preview (Nutri-Score, NOVA); ingredients and allergens need /api/details. */
const isFull = (d: ProductDetails | undefined): d is ProductDetails => !!d && (d.ingredients !== undefined || d.allergens !== undefined);

function Details({ ean, initial }: { ean: string; initial?: ProductDetails }) {
  const [state, setState] = useState<{ phase: 'loading' | 'ok' | 'error'; details: ProductDetails | null }>({
    phase: isFull(initial) ? 'ok' : 'loading',
    details: initial ?? null,
  });
  const [attempt, setAttempt] = useState(0);
  // The product can gain details while the sheet is open (search still streaming);
  // read the latest preview without refetching for it.
  const latest = useRef(initial);
  latest.current = initial;
  const full = isFull(initial);
  useEffect(() => {
    if (full && attempt === 0) {
      setState({ phase: 'ok', details: latest.current ?? null });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, phase: s.details && isFull(s.details) ? s.phase : 'loading' }));
    loadDetails(ean)
      .then((details) => alive && setState({ phase: 'ok', details: details ? { ...(latest.current ?? {}), ...details } : latest.current ?? null }))
      .catch(() => alive && setState({ phase: 'error', details: null }));
    return () => {
      alive = false;
    };
  }, [ean, full, attempt]);

  const d = state.details;
  return (
    <section className="full details" aria-labelledby="det-h" aria-busy={state.phase === 'loading'}>
      <h2 id="det-h" className="section-title" style={{ marginBottom: 10 }}>
        Detalles
      </h2>
      {state.phase === 'loading' && (
        <div className="screen" style={{ gap: 8 }} aria-label="Cargando detalles">
          <span className="skel" style={{ height: 32, width: 150 }} />
          <span className="skel" style={{ height: 14, width: '95%' }} />
          <span className="skel" style={{ height: 14, width: '70%' }} />
        </div>
      )}
      {state.phase === 'error' && (
        <div className="notice error" role="alert">
          <Icon name="warn" />
          <div>
            <p>No hemos podido cargar los detalles de Open Food Facts.</p>
            <button type="button" className="btn btn-secondary btn-small" style={{ marginTop: 8 }} onClick={() => setAttempt((a) => a + 1)}>
              Reintentar
            </button>
          </div>
        </div>
      )}
      {state.phase === 'ok' && !d && <p className="muted">Open Food Facts no tiene detalles de este producto.</p>}
      {state.phase === 'ok' && d && (
        <motion.dl initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: DUR.base }}>
          {d.nutriscore && (
            <div>
              <dt>Nutri-Score</dt>
              <dd>
                <span className="nutri" role="img" aria-label={`Nutri-Score ${d.nutriscore.toUpperCase()}`}>
                  {['a', 'b', 'c', 'd', 'e'].map((l) => (
                    <span key={l} className={l === d.nutriscore?.toLowerCase() ? 'on' : ''} style={{ background: NUTRI_COLORS[l] }}>
                      {l.toUpperCase()}
                    </span>
                  ))}
                </span>
                {d.nova != null && (
                  <span className="tag" style={{ marginLeft: 10 }}>
                    NOVA {d.nova}
                  </span>
                )}
              </dd>
            </div>
          )}
          {d.ingredients && (
            <div>
              <dt>Ingredientes</dt>
              <dd>{d.ingredients}</dd>
            </div>
          )}
          <div>
            <dt>Alérgenos</dt>
            <dd>
              {d.allergens?.length ? (
                <span className="chips" style={{ gap: 6 }}>
                  {d.allergens.map((a) => (
                    <span key={a} className="tag promo" style={{ textTransform: 'none', fontSize: '0.85rem' }}>
                      {a.replace(/^[a-z]{2}:/, '')}
                    </span>
                  ))}
                </span>
              ) : (
                <span className="muted">{d.allergens ? 'No declara alérgenos.' : 'Sin datos de alérgenos.'}</span>
              )}
            </dd>
          </div>
        </motion.dl>
      )}
      <p className="muted" style={{ fontSize: '0.8rem', marginTop: 10 }}>
        Datos de Open Food Facts (licencia ODbL). Revisa siempre la etiqueta.
      </p>
    </section>
  );
}
