import { useEffect, useRef } from 'react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { formatEuros } from '@shared/units';
import { Dock, Ticker } from './components/feedback';
import { Coin, Icon, type IconName } from './components/Icon';
import { Cesti } from './components/Mascot';
import { Sheet } from './components/Sheet';
import { resumePending } from './lib/hunt';
import { DUR, EASE_OUT } from './lib/motion';
import { closeOverlay, hrefFor, openOverlay, useRoute, type Path } from './lib/router';
import { useSearchActivity } from './lib/search';
import { useStore } from './lib/store';
import { CartScreen } from './screens/Cart';
import { Ficha } from './screens/Ficha';
import { PlanScreen } from './screens/Plan';
import { SearchScreen } from './screens/Search';
import { SettingsScreen } from './screens/Settings';

const TABS: Array<{ path: Path; label: string; icon: IconName }> = [
  { path: '/buscar', label: 'Buscar', icon: 'search' },
  { path: '/cesta', label: 'Cesta', icon: 'basket' },
  { path: '/plan', label: 'Plan', icon: 'route' },
];

export function App() {
  const route = useRoute();
  const productKey = route.params.get('p');
  const settingsOpen = route.params.has('ajustes');
  // The screen the app opened on appears without a fade; later tab changes fade in.
  const firstPath = useRef<Path | null>(route.path);
  useEffect(() => {
    if (firstPath.current !== route.path) firstPath.current = null;
  }, [route.path]);

  useEffect(() => {
    resumePending();
  }, []);

  useEffect(() => {
    const t = TABS.find((x) => x.path === route.path)?.label ?? 'Buscar';
    document.title = `${t} · Cesta`;
  }, [route.path]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <a href="#contenido" className="sr-only skip-link" onClick={(e) => {
          e.preventDefault();
          document.getElementById('contenido')?.focus();
        }}>
          Saltar al contenido
        </a>
        <Header path={route.path} />
        <main className="main" id="contenido" tabIndex={-1}>
          {/* Tabs swap at once (no exit to wait for) and the new screen fades in: the tab
              indicator already slides, so this stays short and never leaves a blank gap. */}
          <motion.div
            key={route.path}
            initial={firstPath.current === route.path ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: DUR.fast, ease: EASE_OUT }}
          >
            {route.path === '/cesta' ? <CartScreen /> : route.path === '/plan' ? <PlanScreen /> : <SearchScreen />}
          </motion.div>
        </main>
        <TabBar path={route.path} />
        <Dock />
        <AnimatePresence>
          {productKey && (
            <Sheet key={`p-${productKey}`} onClose={closeOverlay} label="Ficha del producto">
              <Ficha productKey={productKey} />
            </Sheet>
          )}
          {settingsOpen && !productKey && (
            <Sheet key="ajustes" onClose={closeOverlay} label="Ajustes">
              <SettingsScreen />
            </Sheet>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}

function useCartCount() {
  return useStore((s) => s.cart.length);
}

/**
 * Where a tab leads. Coming back to Buscar from another tab returns to the last results;
 * tapping Buscar while on it goes to the start (suggestions, recent searches).
 */
function useTabHref() {
  const { q } = useSearchActivity();
  return (to: Path, from: Path) => (to === '/buscar' && from !== '/buscar' ? hrefFor('/buscar', { q }) : hrefFor(to));
}

function CartBadge({ count }: { count: number }) {
  return (
    <AnimatePresence initial={false}>
      {count > 0 && (
        <motion.span
          key="badge"
          className="badge"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.9 }}
          transition={{ duration: DUR.base, ease: EASE_OUT }}
          aria-hidden="true"
        >
          <motion.span key={count} style={{ display: 'inline-block' }} initial={{ scale: 1.3 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 500, damping: 18 }}>
            {count}
          </motion.span>
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function Header({ path }: { path: Path }) {
  const count = useCartCount();
  const tabHref = useTabHref();
  const savings = useStore((s) => s.savings);
  const saved = savings.reduce((a, b) => a + b.cents, 0);
  return (
    <header className="header">
      <div className="header-inner">
        <a className="brand" href={hrefFor('/buscar')} aria-label="Cesta, inicio">
          <Cesti size={36} mood="idle" />
          <span>cesta</span>
        </a>
        <nav className="topnav" aria-label="Secciones">
          {TABS.map((t) => (
            <a key={t.path} href={tabHref(t.path, path)} aria-current={path === t.path ? 'page' : undefined} style={{ isolation: 'isolate' }}>
              {path === t.path && <motion.span layoutId="topnav-ind" className="nav-indicator" transition={{ duration: DUR.slow, ease: EASE_OUT }} />}
              <Icon name={t.icon} size={20} />
              {t.label}
              {t.path === '/cesta' && <CartBadge count={count} />}
            </a>
          ))}
        </nav>
        <span className="spacer" />
        <span
          className="coin"
          role="img"
          aria-label={saved ? `Has ahorrado ${formatEuros(saved)} en ${savings.length} ${savings.length === 1 ? 'compra' : 'compras'}` : 'Aún no has apuntado ahorros'}
          title="Lo que llevas ahorrado"
        >
          <Coin />
          <span aria-hidden="true">
            <Ticker cents={saved} />
          </span>
        </span>
        <button type="button" className="icon-btn" aria-label="Ajustes" onClick={() => openOverlay('ajustes', '1')}>
          <Icon name="gear" />
        </button>
      </div>
    </header>
  );
}

function TabBar({ path }: { path: Path }) {
  const count = useCartCount();
  const tabHref = useTabHref();
  return (
    <nav className="tabbar" aria-label="Secciones">
      {TABS.map((t) => (
        <a key={t.path} href={tabHref(t.path, path)} aria-current={path === t.path ? 'page' : undefined} aria-label={t.path === '/cesta' && count ? `${t.label}, ${count} productos` : t.label}>
          <span className="tab-icon">
            {path === t.path && <motion.span layoutId="tab-ind" className="tab-indicator" transition={{ duration: DUR.slow, ease: EASE_OUT }} />}
            <Icon name={t.icon} size={24} />
            {t.path === '/cesta' && <CartBadge count={count} />}
          </span>
          {t.label}
        </a>
      ))}
    </nav>
  );
}
