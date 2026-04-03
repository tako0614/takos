import { createSignal, onMount, onCleanup, For, Show } from 'solid-js';
import { Icons } from '../../lib/Icons.tsx';
import type { Toast } from '../../types/index.ts';
import { useToast } from '../../store/toast.ts';

/** Renders the global toast list from the shared Solid store. */
export function ToastRenderer() {
  const { toasts, dismissToast } = useToast();
  return <ToastContainer toasts={toasts} onDismiss={dismissToast} />;
}

const iconClasses: Record<Toast['type'], string> = {
  success: 'text-[var(--color-text-primary)] opacity-90',
  error: 'text-[var(--color-error)] opacity-90',
  info: 'text-[var(--color-text-secondary)] opacity-90',
};

export function ToastContainer(props: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  const [isMobile, setIsMobile] = createSignal(
    typeof globalThis.innerWidth === 'number' ? globalThis.innerWidth < 768 : false
  );

  onMount(() => {
    const checkMobile = () => setIsMobile(globalThis.innerWidth < 768);
    globalThis.addEventListener('resize', checkMobile);
    onCleanup(() => globalThis.removeEventListener('resize', checkMobile));
  });

  return (
    <Show when={props.toasts.length > 0}>
      <div
        class={`
          fixed z-[9999] flex flex-col gap-3 pointer-events-none
          ${isMobile()
            ? 'bottom-[calc(var(--nav-height-mobile)+1rem+var(--spacing-safe-bottom))] left-4 right-4 items-center'
            : 'bottom-6 right-6 items-end'
          }
        `}
      >
        <For each={props.toasts}>{(toast) =>
          <div
            class={`
              flex items-center gap-3 px-4 py-3 rounded-[var(--radius-md)]
              border border-[var(--color-border-primary)] shadow-[var(--shadow-lg)]
              bg-[var(--color-surface-primary)] animate-[slideUp_0.2s_ease-out]
              pointer-events-auto
              ${isMobile() ? 'w-full' : 'max-w-[400px]'}
            `}
          >
            <span class={`shrink-0 ${iconClasses[toast.type]}`}>
              <Show when={toast.type === 'success'}><Icons.Check class="w-5 h-5 block" /></Show>
              <Show when={toast.type === 'error'}><Icons.AlertTriangle class="w-5 h-5 block" /></Show>
              <Show when={toast.type === 'info'}><Icons.Bell class="w-5 h-5 block" /></Show>
            </span>
            <span class="text-sm text-[var(--color-text-primary)]">{toast.message}</span>
            <button
              type="button"
              class="shrink-0 p-1 rounded-[var(--radius-sm)] text-[var(--color-text-tertiary)] bg-transparent border-none cursor-pointer flex items-center justify-center transition-colors hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)]"
              onClick={() => props.onDismiss(toast.id)}
            >
              <Icons.X class="w-4 h-4 block" />
            </button>
          </div>
        }</For>
      </div>
    </Show>
  );
}
