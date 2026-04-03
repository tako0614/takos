import { makePersisted } from '@solid-primitives/storage';
import { createRoot, createSignal } from 'solid-js';
import type { Signal } from 'solid-js';

/**
 * Creates a Solid signal persisted to localStorage.
 * The signal lives for the lifetime of the app.
 */
export function createPersistedSignal<T>(
  key: string,
  defaultValue: T,
): Signal<T> {
  return createRoot(() => {
    const [value, setValue] = createSignal<T>(defaultValue);
    const [persistedValue, persistedSetValue] = makePersisted(
      [value, setValue],
      { name: key },
    );
    return [persistedValue, persistedSetValue];
  });
}
