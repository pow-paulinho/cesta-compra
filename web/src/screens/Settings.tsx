import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { CHAIN_IDS, type ChainId, type LiveStatus } from '@shared/types';
import { CHAINS } from '@shared/chains';
import { Icon } from '../components/Icon';
import { ChainDot, Switch } from '../components/ui';
import { liveHeaders } from '../lib/api';
import { forget, retryLocked } from '../lib/hunt';
import { DUR, EASE_OUT } from '../lib/motion';
import { errorMessage, NETWORK_ERROR } from '../lib/ndjson';
import { getState, setState, updateSettings, useStore } from '../lib/store';
import { toast } from '../lib/toast';

type Probe = { phase: 'idle' } | { phase: 'loading' } | { phase: 'ok'; result: LiveStatus } | { phase: 'error'; message: string };

export function SettingsScreen() {
  const settings = useStore((s) => s.settings);
  const cartCount = useStore((s) => s.cart.length);
  const [key, setKey] = useState(settings.liveKey);
  const [show, setShow] = useState(false);
  const [probe, setProbe] = useState<Probe>({ phase: 'idle' });
  const [confirm, setConfirm] = useState(false);
  const [chainError, setChainError] = useState(false);

  const test = async () => {
    const k = key.trim();
    updateSettings({ liveKey: k });
    setProbe({ phase: 'loading' });
    try {
      const res = await fetch('/api/live', { headers: liveHeaders(k) });
      if (!res.ok) {
        setProbe({ phase: 'error', message: await errorMessage(res) });
        return;
      }
      const result = (await res.json()) as LiveStatus;
      setProbe({ phase: 'ok', result });
      if (result.live) {
        const n = retryLocked();
        if (n) toast({ text: `Clave correcta. Volvemos a buscar ${n} ${n === 1 ? 'producto' : 'productos'} en vivo.`, tone: 'success' });
      }
    } catch {
      setProbe({ phase: 'error', message: NETWORK_ERROR });
    }
  };

  const toggleChain = (c: ChainId) => {
    const on = settings.chains.includes(c);
    if (on && settings.chains.length === 1) {
      setChainError(true);
      return;
    }
    setChainError(false);
    updateSettings({ chains: on ? settings.chains.filter((x) => x !== c) : CHAIN_IDS.filter((x) => x === c || settings.chains.includes(x)) });
  };

  const clearCart = () => {
    const before = getState().cart;
    before.forEach((i) => forget(i.id));
    setState((s) => ({ ...s, cart: [] }));
    setConfirm(false);
    toast({ text: `Cesta vaciada (${before.length} ${before.length === 1 ? 'producto' : 'productos'}).`, action: { label: 'Deshacer', run: () => setState((s) => ({ ...s, cart: [...before, ...s.cart] })) } });
  };

  return (
    <div className="settings">
      <h1 style={{ paddingRight: 40 }}>Ajustes</h1>

      <section aria-labelledby="key-h">
        <h2 id="key-h">Clave de búsqueda en vivo</h2>
        <p className="muted" style={{ fontWeight: 650 }}>
          Con tu clave buscamos en directo en las webs que lo permiten (Alcampo, Aldi, Ahorramas). Se guarda solo en este navegador y se envía a tu servidor
          en cada búsqueda.
        </p>
        <form
          className="row"
          style={{ alignItems: 'stretch' }}
          onSubmit={(e) => {
            e.preventDefault();
            void test();
          }}
        >
          <label htmlFor="live-key" className="sr-only">
            Clave de búsqueda en vivo
          </label>
          <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
            <input
              id="live-key"
              className="input"
              type={show ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              placeholder="Pega aquí tu clave"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              style={{ paddingRight: 48 }}
            />
            <button
              type="button"
              className="icon-btn"
              style={{ position: 'absolute', right: 2, top: 2 }}
              aria-label={show ? 'Ocultar clave' : 'Mostrar clave'}
              aria-pressed={show}
              onClick={() => setShow((v) => !v)}
            >
              <Icon name="eye" size={20} />
            </button>
          </div>
          <button type="submit" className="btn btn-secondary" disabled={probe.phase === 'loading'}>
            {probe.phase === 'loading' ? 'Probando…' : 'Probar'}
          </button>
        </form>
        <div aria-live="polite">
          <AnimatePresence mode="wait" initial={false}>
            {probe.phase === 'ok' && (
              <motion.div key="ok" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: DUR.base, ease: EASE_OUT }}>
                <div className={`notice ${probe.result.live ? '' : 'warn'}`} style={probe.result.live ? { background: 'var(--green-tint)', color: 'var(--green-ink)' } : undefined}>
                  <Icon name={probe.result.live ? 'check' : 'lock'} />
                  <span>
                    {probe.result.live
                      ? probe.result.chains.some((c) => c.mode === 'live')
                        ? '¡Clave correcta! Así busca cada cadena:'
                        : '¡Clave correcta! Pero este servidor aún no busca en vivo en ninguna cadena: de momento todo sale de Open Prices.'
                      : probe.result.access === 'disabled'
                        ? 'El servidor no tiene la búsqueda en vivo activada (falta LIVE_KEY). Configúrala con «wrangler secret put LIVE_KEY» o en .dev.vars.'
                        : key.trim()
                          ? 'La clave no coincide con la del servidor. Revisa que sea la misma que LIVE_KEY (sin espacios).'
                          : 'Sin clave: solo verás precios del catálogo (Open Prices).'}
                  </span>
                </div>
                <ul className="live-list" style={{ marginTop: 10 }}>
                  {probe.result.chains.map((c) => (
                    <li key={c.id}>
                      <ChainDot chain={c.id} />
                      <span>
                        <b>{c.name}</b>{' '}
                        {c.mode === 'live' ? (
                          <span className={`tag ${probe.result.live ? 'live' : ''}`}>{probe.result.live ? 'en vivo' : 'en vivo con clave'}</span>
                        ) : (
                          <span className="tag">Open Prices</span>
                        )}
                        {c.reason && (
                          <span className="muted" style={{ display: 'block', fontSize: '0.82rem' }}>
                            {c.reason}
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            )}
            {probe.phase === 'error' && (
              <motion.p key="err" className="notice error" role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Icon name="warn" /> {probe.message}
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </section>

      <section aria-labelledby="demo-h">
        <div className="toggle-row">
          <div className="text">
            <h2 id="demo-h">Usar precios demo</h2>
            <p className="muted" style={{ fontWeight: 650, fontSize: '0.92rem' }}>
              Usa precios de ejemplo en lugar de Open Prices en los súper que no buscamos en vivo, para probar la app. No se mezclan con los reales y
              siempre los verás marcados como «demo».
            </p>
          </div>
          <Switch checked={settings.demo} onChange={(demo) => updateSettings({ demo })} labelledBy="demo-h" />
        </div>
      </section>

      <section aria-labelledby="chains-h">
        <h2 id="chains-h">Súper activos</h2>
        <p className="muted" style={{ fontWeight: 650, fontSize: '0.92rem' }}>
          Solo buscamos y planificamos en los que tengas marcados.
        </p>
        <div className="chain-grid" role="group" aria-labelledby="chains-h">
          {CHAIN_IDS.map((c) => {
            const on = settings.chains.includes(c);
            return (
              <button key={c} type="button" role="checkbox" aria-checked={on} className="chain-toggle" onClick={() => toggleChain(c)}>
                <ChainDot chain={c} />
                {CHAINS[c].name}
                <span className="check" aria-hidden="true">
                  {on && <Icon name="check" size={16} />}
                </span>
              </button>
            );
          })}
        </div>
        {chainError && (
          <p className="field-error" role="alert">
            Deja al menos un súper activo.
          </p>
        )}
      </section>

      <section aria-labelledby="clear-h">
        <h2 id="clear-h">Borrar cesta</h2>
        {!confirm ? (
          <button type="button" className="btn btn-secondary" style={{ color: 'var(--red-ink)', alignSelf: 'flex-start' }} disabled={!cartCount} onClick={() => setConfirm(true)}>
            <Icon name="trash" size={20} /> Borrar cesta
          </button>
        ) : (
          <motion.div className="notice error" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: DUR.base, ease: EASE_OUT }} role="alertdialog" aria-labelledby="confirm-t">
            <div style={{ flex: 1 }}>
              <p id="confirm-t">
                ¿Seguro? Se quitarán {cartCount} {cartCount === 1 ? 'producto' : 'productos'} y sus búsquedas.
              </p>
              <div className="row" style={{ marginTop: 10, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-secondary btn-small" onClick={() => setConfirm(false)} autoFocus>
                  Cancelar
                </button>
                <button type="button" className="btn btn-danger btn-small" onClick={clearCart}>
                  Sí, borrar
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </section>
    </div>
  );
}
