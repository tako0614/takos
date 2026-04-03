import { createSignal } from 'solid-js';

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

const [confirmDialogState, setConfirmDialogState] = createSignal(
  initialState,
);

export function useConfirmDialog() {
  const confirm = (options: ConfirmDialogOptions): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      setConfirmDialogState({
        isOpen: true,
        ...options,
        resolve,
      });
    });

  return { confirm };
}

export function useConfirmDialogState() {
  return confirmDialogState;
}

export function useConfirmDialogActions() {
  const handleConfirm = () => {
    setConfirmDialogState((prev) => {
      prev.resolve?.(true);
      return { ...initialState };
    });
  };

  const handleCancel = () => {
    setConfirmDialogState((prev) => {
      prev.resolve?.(false);
      return { ...initialState };
    });
  };

  return { handleConfirm, handleCancel };
}
