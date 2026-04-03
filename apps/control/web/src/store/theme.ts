import { createSignal } from 'solid-js';
import { createPersistedSignal } from '../lib/storage-atom.ts';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'takos-theme';

function getSystemTheme(): ResolvedTheme {
  if (globalThis.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

const [themePreference, setThemePreference] = createPersistedSignal<Theme>(
  STORAGE_KEY,
  'system',
);
const [systemTheme, setSystemTheme] = createSignal<ResolvedTheme>(
  getSystemTheme(),
);

const resolvedTheme = (): ResolvedTheme => {
  const preference = themePreference();
  return preference === 'system' ? systemTheme() : preference;
};

export function useTheme() {
  return {
    get themePreference() {
      return themePreference();
    },
    setThemePreference,
    get systemTheme() {
      return systemTheme();
    },
    setSystemTheme,
    get resolvedTheme() {
      return resolvedTheme();
    },
  };
}
