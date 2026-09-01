import { createSignal } from "solid-js";

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  /** Exact text the user must enter before a destructive action is enabled. */
  confirmationText?: string;
  confirmationLabel?: string;
}

interface ConfirmDialogState {
  isOpen: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  confirmationText?: string;
  confirmationLabel?: string;
  resolve: ((value: boolean) => void) | null;
}

const initialState: ConfirmDialogState = {
  isOpen: false,
  title: "",
  message: "",
  resolve: null,
};

const [confirmDialogState, setConfirmDialogState] = createSignal(
  initialState,
);

export function useConfirmDialog() {
  const confirm = (options: ConfirmDialogOptions): Promise<boolean> => {
    const current = confirmDialogState();
    if (current.isOpen || current.resolve) {
      return Promise.resolve(false);
    }
    return new Promise<boolean>((resolve) => {
      setConfirmDialogState({
        isOpen: true,
        ...options,
        resolve,
      });
    });
  };

  return { confirm };
}

export function useConfirmDialogState() {
  return confirmDialogState;
}

export function useConfirmDialogActions() {
  const settle = (accepted: boolean) => {
    const resolve = confirmDialogState().resolve;
    setConfirmDialogState({ ...initialState });
    resolve?.(accepted);
  };

  const handleConfirm = () => settle(true);
  const handleCancel = () => settle(false);

  return { handleConfirm, handleCancel };
}
