import { atom, useSetAtom, useAtomValue } from 'jotai';
import { useCallback } from 'react';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
}

interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  resolve: ((value: boolean) => void) | null;
}

const initialState: ConfirmDialogState = {
  isOpen: false,
  title: '',
  message: '',
  resolve: null,
};

export const confirmDialogAtom = atom<ConfirmDialogState>(initialState);

/**
 * Hook that returns a `confirm(options)` function identical to the old
 * ConfirmDialogProvider interface.  Works anywhere inside the Jotai Provider
 * (or with the default store) -- no React context wrapper needed.
 */
export function useConfirmDialog() {
  const setState = useSetAtom(confirmDialogAtom);

  const confirm = useCallback(
    (options: ConfirmDialogOptions): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        setState({
          isOpen: true,
          ...options,
          resolve,
        });
      }),
    [setState],
  );

  return { confirm };
}

/** Read-side hook consumed by the dialog renderer component. */
export function useConfirmDialogState() {
  return useAtomValue(confirmDialogAtom);
}

/** Write-side hook consumed by the dialog renderer component. */
export function useConfirmDialogActions() {
  const setState = useSetAtom(confirmDialogAtom);

  const handleConfirm = useCallback(() => {
    setState((prev) => {
      prev.resolve?.(true);
      return { ...initialState };
    });
  }, [setState]);

  const handleCancel = useCallback(() => {
    setState((prev) => {
      prev.resolve?.(false);
      return { ...initialState };
    });
  }, [setState]);

  return { handleConfirm, handleCancel };
}
