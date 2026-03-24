import { useEffect, useCallback, useRef } from 'react';

const layerStack: string[] = [];

interface UseDialogLifecycleOptions {
  isOpen: boolean;
  layerId?: string;
  onEscape?: () => void;
  closeOnEscape?: boolean;
  lockBodyScroll?: boolean;
}

export function useDialogLifecycle({
  isOpen,
  layerId,
  onEscape,
  closeOnEscape = true,
  lockBodyScroll = true,
}: UseDialogLifecycleOptions): () => boolean {
  const layerIdRef = useRef(layerId);
  layerIdRef.current = layerId;

  useEffect(() => {
    if (!isOpen || !layerIdRef.current) return;

    const id = layerIdRef.current;
    layerStack.push(id);

    return () => {
      const idx = layerStack.indexOf(id);
      if (idx !== -1) layerStack.splice(idx, 1);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229) {
        return;
      }
      if (closeOnEscape && event.key === 'Escape') {
        if (layerIdRef.current && layerStack[layerStack.length - 1] !== layerIdRef.current) {
          return;
        }
        onEscape?.();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    if (lockBodyScroll) {
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      if (lockBodyScroll) {
        document.body.style.overflow = previousOverflow;
      }
    };
  }, [closeOnEscape, isOpen, lockBodyScroll, onEscape]);

  const isTopLayer = useCallback(() => {
    if (!layerIdRef.current) return true;
    return layerStack[layerStack.length - 1] === layerIdRef.current;
  }, []);

  return isTopLayer;
}
