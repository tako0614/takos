import { useState, useEffect } from 'react';
import { Icons } from '../../lib/Icons';
import type { Toast } from '../../types';
import { useToast } from '../../store/toast';

/** Renders the global toast list. No provider needed -- reads Jotai atoms directly. */
export function ToastRenderer() {
  const { toasts, dismissToast } = useToast();
  return <ToastContainer toasts={toasts} onDismiss={dismissToast} />;
}

const iconClasses: Record<Toast['type'], string> = {
  success: 'text-[var(--color-text-primary)] opacity-90',
  error: 'text-[var(--color-error)] opacity-90',
  info: 'text-[var(--color-text-secondary)] opacity-90',
};

export function ToastContainer({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < 768 : false
  );

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div
      className={`
        fixed z-[9999] flex flex-col gap-3 pointer-events-none
        ${isMobile
          ? 'bottom-[calc(var(--nav-height-mobile)+1rem+var(--spacing-safe-bottom))] left-4 right-4 items-center'
          : 'bottom-6 right-6 items-end'
        }
      `}
    >
      {toasts.map(toast => (
        <div
          key={toast.id}
          className={`
            flex items-center gap-3 px-4 py-3 rounded-[var(--radius-md)]
            border border-[var(--color-border-primary)] shadow-[var(--shadow-lg)]
            bg-[var(--color-surface-primary)] animate-[slideUp_0.2s_ease-out]
            pointer-events-auto
            ${isMobile ? 'w-full' : 'max-w-[400px]'}
          `}
        >
          <span className={`shrink-0 ${iconClasses[toast.type]}`}>
            {toast.type === 'success' && <Icons.Check className="w-5 h-5 block" />}
            {toast.type === 'error' && <Icons.AlertTriangle className="w-5 h-5 block" />}
            {toast.type === 'info' && <Icons.Bell className="w-5 h-5 block" />}
          </span>
          <span className="text-sm text-[var(--color-text-primary)]">{toast.message}</span>
          <button
            className="shrink-0 p-1 rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] bg-transparent border-none cursor-pointer flex items-center justify-center transition-colors hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)]"
            onClick={() => onDismiss(toast.id)}
          >
            <Icons.X className="w-4 h-4 block" />
          </button>
        </div>
      ))}
    </div>
  );
}
