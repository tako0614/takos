import { createEffect, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { useAtomValue, useSetAtom } from 'solid-jotai';
import App from './App.tsx';
import { resolvedThemeAtom, systemThemeAtom } from './store/theme.ts';
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

  createEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved());
  });

  createEffect(() => {
    const mq = globalThis.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      setSystemTheme(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', handler);
    onCleanup(() => mq.removeEventListener('change', handler));
  });

  return null;
}

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error("Root element '#root' not found");
}

render(() => (
  <>
    <ThemeSync />
    <App />
  </>
), rootElement);
