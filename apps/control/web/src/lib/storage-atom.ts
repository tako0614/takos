import { atom } from 'jotai/vanilla';
import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';
import type { Signal } from 'solid-js';

/**
 * Creates a Solid signal persisted to localStorage, suitable for use
 * alongside jotai atoms. This replaces jotai/utils' atomWithStorage
 * which depends on React internals.
 *
 * Usage: const [value, setValue] = createPersistedSignal('key', defaultValue);
 */
export function createPersistedSignal<T>(key: string, defaultValue: T): Signal<T> {
  const [value, setValue] = createSignal<T>(defaultValue);
  const persisted = makePersisted([value, setValue] as Signal<T>, { name: key });
  return [persisted[0], persisted[1]] as Signal<T>;
}

/**
 * Creates a jotai atom backed by localStorage.
 * The atom reads/writes localStorage directly (vanilla, no React).
 */
export function atomWithStorageVanilla<T>(key: string, initialValue: T) {
  const stored = typeof window !== 'undefined' ? localStorage.getItem(key) : null;
  const parsed: T = stored !== null ? (JSON.parse(stored) as T) : initialValue;

  const baseAtom = atom<T>(parsed);

  const persistedAtom = atom(
    (get) => get(baseAtom),
    (_get, set, newValue: T) => {
      set(baseAtom, newValue);
      if (typeof window !== 'undefined') {
        localStorage.setItem(key, JSON.stringify(newValue));
      }
    },
  );

  return persistedAtom;
}
