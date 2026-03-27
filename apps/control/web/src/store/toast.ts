import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback } from 'react';
import type { Toast } from '../types';

export const toastsAtom = atom<Toast[]>([]);

/** Write-only atom that adds a toast and auto-dismisses after 4 seconds */
export const showToastAtom = atom(
  null,
  (get, set, { type, message }: { type: Toast['type']; message: string }) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    set(toastsAtom, [...get(toastsAtom), { id, type, message }]);
    setTimeout(() => {
      set(toastsAtom, (prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  },
);

/** Write-only atom that removes a toast by id */
export const dismissToastAtom = atom(
  null,
  (get, set, id: string) => {
    set(toastsAtom, get(toastsAtom).filter((t) => t.id !== id));
  },
);

export function useToast() {
  const toasts = useAtomValue(toastsAtom);
  const dispatch = useSetAtom(showToastAtom);
  const dismiss = useSetAtom(dismissToastAtom);

  const showToast = useCallback(
    (type: Toast['type'], message: string) => dispatch({ type, message }),
    [dispatch],
  );
  const dismissToast = useCallback(
    (id: string) => dismiss(id),
    [dismiss],
  );

  return { toasts, showToast, dismissToast };
}
