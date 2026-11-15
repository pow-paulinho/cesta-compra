import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Product } from '@shared/types';
import { CHAINS } from '@shared/chains';
import { EVERGREEN_TIPS } from '@shared/tips';
import { Icon } from '../components/Icon';
import { Cesti } from '../components/Mascot';
import { ProductCard, SkeletonCard } from '../components/ProductCard';
import { Popover } from '../components/ui';
import { greeting } from '../lib/format';
import { DUR, EASE_OUT } from '../lib/motion';
import { navigate, openOverlay, useRoute } from '../lib/router';
import { forgetSearch, sourceName, useSearch, type SourceState } from '../lib/search';
import { addRecent, clearRecent, useStore } from '../lib/store';
import { rememberProducts } from '../lib/products';

const SUGGESTIONS = ['Leche', 'Aceite de oliva', 'Huevos', 'Café', 'Yogur', 'Pan de molde', 'Tomate triturado', 'Atún', 'Arroz', 'Galletas'];

export function SearchScreen() {
  const route = useRoute();
  const q = (route.params.get('q') ?? '').trim();
  const liveKey = useStore((s) => s.settings.liveKey);
  const demo = useStore((s) => s.settings.demo);
  const recent = useStore((s) => s.recent);
  const [text, setText] = useState(q);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const search = useSearch(q, liveKey, demo, attempt);

  useEffect(() => setText(q), [q]);

  // "/" focuses the search field from anywhere on this screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, [contenteditable="true"], [role="dialog"]')) return;
      e.preventDefault();
      input.current?.focus();
      input.current?.select();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const submit = (value: string) => {
    const v = value.trim();
    if (v.length < 2) {
      setError('Escribe al menos 2 letras, por ejemplo «leche».');
      input.current?.focus();
      return;
    }
    if (v.length > 80) {
      setError('Demasiado largo: usa como mucho 80 caracteres.');
      return;
    }
    setError(null);
    addRecent(v);
    input.current?.blur();
    if (v === q) setAttempt((a) => a + 1);
    else {
      // A search the person asks for is always fresh; only going back and forth reuses results.
      forgetSearch(v);
      navigate('/buscar', { q: v });
    }
  };

  const open = (p: Product) => {
    rememberProducts([p]);
    openOverlay('p', p.key);
  };

  const loading = search.phase === 'loading';
  // Products with a price first; otherwise in arrival order (stable while streaming).
  const ordered = useMemo(() => {
    const priced = search.products.filter((p) => p.offers.some((o) => o.priceCents > 0));
    return priced.length === search.products.length ? priced : [...priced, ...search.products.filter((p) => !priced.includes(p))];
  }, [search.products]);
  const showSkeleton = loading && search.products.length === 0;

  return (
    <div className="screen">
      {!q && <Hello />}
      <form
        className="search-form"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <div className="search-box">
          <label htmlFor="q" className="sr-only">
            Buscar un producto
          </label>
          <Icon name="search" />
          <input
            id="q"
            ref={input}
            className="input"
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Leche, café, huevos…"
            value={text}
            maxLength={80}
            aria-invalid={!!error}
            aria-describedby={error ? 'q-error' : undefined}
            onChange={(e) => {
              setText(e.target.value);
              if (error) setError(null);
            }}
          />
          {text ? (
            <button
              type="button"
              className="icon-btn clear"
              aria-label="Borrar texto"
              onClick={() => {
                setText('');
                input.current?.focus();
              }}
            >
              <Icon name="close" size={18} />
            </button>
          ) : (
            <span className="kbd" aria-hidden="true">
              /
            </span>
          )}
        </div>
        <button className="btn btn-blue" type="submit" aria-label="Buscar">
          <Icon name="search" />
        </button>
      </form>
      {error && (
        <p className="field-error" id="q-error" role="alert">
          {error}
        </p>
      )}

      {!q && (
        <>
          <section aria-labelledby="sug">
            <h2 className="section-title" id="sug" style={{ marginBottom: 10 }}>
              Ideas para empezar
            </h2>
            <div className="chips">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="chip" onClick={() => submit(s)}>
                  {s}
                </button>
              ))}
            </div>
          </section>
          {recent.length > 0 && (
            <section aria-labelledby="rec">
              <div className="section-title" style={{ marginBottom: 6 }}>
                <h2 id="rec" style={{ font: 'inherit' }}>
                  Búsquedas recientes
                </h2>
                <button type="button" className="btn btn-ghost btn-small" onClick={clearRecent}>
                  Borrar
                </button>
              </div>
              <div className="chips">
                {recent.map((r) => (
                  <button key={r} type="button" className="chip" onClick={() => submit(r)}>
                    <Icon name="clock" size={16} />
                    {r}
                  </button>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {q && (
        <section aria-labelledby="res" className="screen" style={{ gap: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <h1 id="res" style={{ fontSize: '1.35rem' }}>
              {loading ? 'Buscando' : 'Resultados para'} «{q}»
            </h1>
            <span className="muted" style={{ fontWeight: 800, fontSize: '0.9rem' }}>
              {search.products.length > 0 && `${search.products.length} ${search.products.length === 1 ? 'producto' : 'productos'}`}
            </span>
          </div>
          <SourcePills sources={search.sources} />

          {search.phase === 'error' && (
            <div className="notice error" role="alert">
              <Icon name="warn" />
              <div style={{ flex: 1 }}>
                <p>{search.error}</p>
                <button type="button" className="btn btn-secondary btn-small" style={{ marginTop: 8 }} onClick={() => setAttempt((a) => a + 1)}>
                  <Icon name="refresh" size={18} /> Reintentar
                </button>
              </div>
            </div>
          )}

          {search.phase === 'done' && search.products.length === 0 && (
            <div className="empty">
              <Cesti mood="sad" size={96} />
              <h2>No hemos encontrado «{q}»</h2>
              <p>Prueba con una palabra más general («leche» en vez de «leche semi de oferta») o revisa cómo está escrito.</p>
            </div>
          )}

          <ul className="grid" style={{ margin: 0, padding: 0 }} aria-busy={loading}>
            {showSkeleton && Array.from({ length: 6 }, (_, i) => <SkeletonCard key={`s${i}`} />)}
            <AnimatePresence mode="popLayout">
              {ordered.map((p, i) => (
                <ProductCard key={p.key} product={p} index={i} onOpen={open} />
              ))}
            </AnimatePresence>
          </ul>
        </section>
      )}
    </div>
  );
}

function Hello() {
  const [tip, setTip] = useState(() => Math.floor(Math.random() * EVERGREEN_TIPS.length));
  const t = EVERGREEN_TIPS[tip % EVERGREEN_TIPS.length]!;
  return (
    <div className="screen" style={{ gap: 14 }}>
      <div>
        <h1>{greeting()}</h1>
        <p className="muted" style={{ fontWeight: 800, fontSize: '1.05rem', marginTop: 2 }}>
          ¿Qué necesitas comprar hoy?
        </p>
      </div>
      <div className="hello">
        <Cesti mood="idle" size={80} />
        <button type="button" className="bubble" onClick={() => setTip((n) => n + 1)} aria-label={`Consejo: ${t.title}. ${t.body} Toca para ver otro.`}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={t.id}
              style={{ display: 'block' }}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: DUR.base, ease: EASE_OUT }}
            >
              <strong>
                {t.icon} {t.title}
              </strong>
              {t.body}
            </motion.span>
          </AnimatePresence>
        </button>
      </div>
    </div>
  );
}

function pillClass(s: SourceState) {
  if (s.status === 'pending') return 'pending';
  if (s.status === 'ok') return 'ok';
  // Not searched here (not wired on this server, or no answer): neutral, not an error.
  if (s.status === 'none' || s.status === 'unavailable') return 'none';
  if (s.status === 'locked') return 'locked';
  return 'bad';
}

function pillText(s: SourceState) {
  switch (s.status) {
    case 'pending':
      return 'buscando…';
    case 'ok':
      return `ok ${s.count}`;
    case 'none':
      return 'sin resultados';
    case 'locked':
      return 'sin clave 🔒';
    case 'blocked':
      return 'bloqueado';
    case 'unavailable':
      return 'no disponible';
    default:
      return 'error';
  }
}

function explain(s: SourceState): string | null {
  if (s.status === 'locked') {
    // The server says why (no key sent, a wrong key, or live search off on the server).
    const why = s.reason ?? `${sourceName(s.source)} se consulta en vivo en su web, y eso solo se hace con tu clave de búsqueda en vivo. Añádela en Ajustes (rueda arriba a la derecha).`;
    return `${why} Mientras tanto verás los precios del catálogo.`;
  }
  if (s.reason) return s.reason;
  if (s.source === 'catalogo') return 'Precios guardados de Open Prices (datos abiertos que comparte la gente). Con los precios demo activados en Ajustes, verás precios de ejemplo en su lugar.';
  if (s.source === 'openfoodfacts') return 'Open Food Facts aporta fotos, ingredientes y Nutri-Score, pero no precios.';
  const c = CHAINS[s.source as keyof typeof CHAINS];
  if (c?.mode === 'live') return `Buscamos en la web de ${c.name} en directo, respetando su robots.txt.`;
  return null;
}

function SourcePills({ sources }: { sources: SourceState[] }) {
  const pending = sources.filter((s) => s.status === 'pending').length;
  return (
    <div>
      <p className="sr-only" aria-live="polite">
        {pending ? `Buscando en ${pending} fuentes.` : `Búsqueda terminada en ${sources.length} fuentes.`}
      </p>
      <ul className="pills" style={{ margin: 0, padding: 0, listStyle: 'none' }} aria-label="Estado de cada fuente">
        {sources.map((s) => {
          const why = explain(s);
          const content = (
            <>
              {s.status === 'pending' && <span className="dot-pulse" aria-hidden="true" />}
              <span>{sourceName(s.source)}</span>
              <span style={{ opacity: 0.85, fontWeight: 700 }}>· {pillText(s)}</span>
              {why && <span aria-hidden="true">ⓘ</span>}
            </>
          );
          return (
            <li key={s.source}>
              {why ? (
                <Popover
                  label={`Sobre ${sourceName(s.source)}`}
                  trigger={(props) => (
                    <button type="button" className={`pill ${pillClass(s)}`} {...props} aria-label={`${sourceName(s.source)}: ${pillText(s)}. Más información`}>
                      {content}
                    </button>
                  )}
                >
                  {why}
                </Popover>
              ) : (
                <span className={`pill ${pillClass(s)}`}>{content}</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
