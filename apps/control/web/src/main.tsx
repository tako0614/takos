import { StrictMode, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { useAtomValue, useSetAtom } from 'jotai';
import App from './App';
import { resolvedThemeAtom, systemThemeAtom } from './store/theme';
import './styles.css';

if (import.meta.env.PROD && import.meta.env.MODE !== 'staging-debug') {
  const noop = () => {};
  console.debug = noop;
  console.log = noop;
  console.info = noop;
  console.warn = noop;
  console.error = noop;
}

/** Syncs the resolved theme to `data-theme` on `<html>` and listens for OS color-scheme changes. */
function ThemeSync() {
  const resolved = useAtomValue(resolvedThemeAtom);
  const setSystemTheme = useSetAtom(systemThemeAtom);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [setSystemTheme]);

  return null;
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error("Root element '#root' not found");
}

ReactDOM.createRoot(rootElement).render(
  <StrictMode>
    <ThemeSync />
    <App />
  </StrictMode>
);
