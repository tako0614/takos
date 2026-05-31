import { createSignal } from "solid-js";
import type { Toast } from "../types/index.ts";

const [toasts, setToasts] = createSignal<Toast[]>([]);

function dismissToast(id: string) {
  setToasts((prev) => prev.filter((toast) => toast.id !== id));
}

function showToast(type: Toast["type"], message: string) {
  const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  setToasts((prev) => [...prev, { id, type, message }]);
  setTimeout(() => dismissToast(id), 4000);
}

export function useToast() {
  return {
    get toasts() {
      return toasts();
    },
    showToast,
    dismissToast,
  };
}
