import { createEffect, onCleanup } from "solid-js";

const layerStack: string[] = [];

interface UseDialogLifecycleOptions {
  isOpen: boolean;
  layerId?: string;
  onEscape?: () => void;
  closeOnEscape?: boolean;
  lockBodyScroll?: boolean;
}

export function useDialogLifecycle(
  options: UseDialogLifecycleOptions,
): () => boolean {
  const currentLayerId = options.layerId;

  createEffect(() => {
    if (!options.isOpen || !currentLayerId) return;

    const id = currentLayerId;
    layerStack.push(id);

    onCleanup(() => {
      const idx = layerStack.indexOf(id);
      if (idx !== -1) layerStack.splice(idx, 1);
    });
  });

  createEffect(() => {
    if (!options.isOpen) return;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) {
        return;
      }
      if ((options.closeOnEscape ?? true) && event.key === "Escape") {
        if (
          currentLayerId && layerStack[layerStack.length - 1] !== currentLayerId
        ) {
          return;
        }
        options.onEscape?.();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    if (options.lockBodyScroll ?? true) {
      document.body.style.overflow = "hidden";
    }

    onCleanup(() => {
      document.removeEventListener("keydown", handleKeyDown);
      if (options.lockBodyScroll ?? true) {
        document.body.style.overflow = previousOverflow;
      }
    });
  });

  const isTopLayer = () => {
    if (!currentLayerId) return true;
    return layerStack[layerStack.length - 1] === currentLayerId;
  };

  return isTopLayer;
}
