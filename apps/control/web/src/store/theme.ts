import { atom } from 'jotai/vanilla';
import { atomWithStorageVanilla } from '../lib/storage-atom.ts';

export type Theme = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const STORAGE_KEY = 'takos-theme';

function getSystemTheme(): ResolvedTheme {
  if (globalThis.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark';
  }
  return 'light';
}

/** User preference: 'light' | 'dark' | 'system'. Persisted to localStorage. */
export const themePreferenceAtom = atomWithStorageVanilla<Theme>(STORAGE_KEY, 'system');

/** Writable atom tracking the current OS-level color-scheme. Updated by ThemeSync. */
export const systemThemeAtom = atom<ResolvedTheme>(getSystemTheme());

/** Derived read-only atom: the effective light/dark value after resolving 'system'. */
export const resolvedThemeAtom = atom<ResolvedTheme>((get) => {
  const pref = get(themePreferenceAtom);
  if (pref !== 'system') return pref;
  return get(systemThemeAtom);
});
