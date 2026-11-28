import { createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import type { Toast } from "../../types/index.ts";
import { useToast } from "../../store/toast.ts";
import { useI18n } from "../../store/i18n.ts";

/** Renders the global toast list from the shared Solid store. */
export function ToastRenderer() {
  const toast = useToast();
  return (
    <ToastContainer
      toasts={toast.toasts}
      onDismiss={toast.dismissToast}
      onPause={toast.pauseToast}
      onResume={toast.resumeToast}
    />
  );
}

const iconClasses: Record<Toast["type"], string> = {
  success: "text-[var(--color-text-primary)] opacity-90",
  error: "text-[var(--color-error)] opacity-90",
  info: "text-[var(--color-text-secondary)] opacity-90",
};

export function ToastContainer(
  props: {
    toasts: Toast[];
    onDismiss: (id: string) => void;
    onPause?: (id: string) => void;
    onResume?: (id: string) => void;
  },
) {
  const { t } = useI18n();
  const [isMobile, setIsMobile] = createSignal(
    typeof globalThis.innerWidth === "number"
      ? globalThis.innerWidth < 768
      : false,
  );

  onMount(() => {
    const checkMobile = () => setIsMobile(globalThis.innerWidth < 768);
    globalThis.addEventListener("resize", checkMobile);
    onCleanup(() => globalThis.removeEventListener("resize", checkMobile));
  });

  const errorToasts = () =>
    props.toasts.filter((toast) => toast.type === "error");
  const politeToasts = () =>
    props.toasts.filter((toast) => toast.type !== "error");

  const renderToast = (toast: Toast) => (
    <div
      role={toast.type === "error" ? "alert" : "status"}
      aria-atomic="true"
      onMouseEnter={() => props.onPause?.(toast.id)}
      onMouseLeave={() => props.onResume?.(toast.id)}
      onFocusIn={() => props.onPause?.(toast.id)}
      onFocusOut={() => props.onResume?.(toast.id)}
      class={`
            flex items-center gap-3 px-4 py-3 rounded-[var(--radius-md)]
            border border-[var(--color-border-primary)] shadow-[var(--shadow-lg)]
            bg-[var(--color-surface-primary)] animate-[slideUp_0.2s_ease-out]
            pointer-events-auto
            ${isMobile() ? "w-full" : "max-w-[400px]"}
          `}
    >
      <span class={`shrink-0 ${iconClasses[toast.type]}`} aria-hidden="true">
        <Show when={toast.type === "success"}>
          <Icons.Check class="w-5 h-5 block" />
        </Show>
        <Show when={toast.type === "error"}>
          <Icons.AlertTriangle class="w-5 h-5 block" />
        </Show>
        <Show when={toast.type === "info"}>
          <Icons.Bell class="w-5 h-5 block" />
        </Show>
      </span>
      <span class="flex-1 text-sm text-[var(--color-text-primary)]">
        {toast.message}
      </span>
      <button
        type="button"
        aria-label={t("close")}
        class="shrink-0 min-w-[44px] min-h-[44px] sm:min-w-7 sm:min-h-7 p-1 rounded-[var(--radius-sm)] text-[var(--color-text-secondary)] bg-transparent border-none cursor-pointer flex items-center justify-center transition-colors hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-secondary)]"
        onClick={() => props.onDismiss(toast.id)}
      >
        <Icons.X class="w-4 h-4 block" aria-hidden="true" />
      </button>
    </div>
  );

  // Keep separate persistent polite and assertive live-region containers so
  // assertive error toasts never conflict with a polite ancestor and new
  // announcements are reliably observed without nested aria-live attributes.
  return (
    <div
      class={`
        fixed z-[9999] flex flex-col pointer-events-none
        ${
        isMobile()
          ? "bottom-[calc(var(--nav-height-mobile)+1rem+var(--spacing-safe-bottom))] left-4 right-4 items-center"
          : "bottom-6 right-6 items-end"
      }
      `}
    >
      <div
        aria-live="assertive"
        aria-relevant="additions text"
        class={`flex flex-col gap-3 ${
          isMobile() ? "w-full items-center" : "items-end"
        } ${
          errorToasts().length > 0 && politeToasts().length > 0 ? "mb-3" : ""
        }`}
      >
        <For each={errorToasts()}>{renderToast}</For>
      </div>
      <div
        aria-live="polite"
        aria-relevant="additions text"
        class={`flex flex-col gap-3 ${
          isMobile() ? "w-full items-center" : "items-end"
        }`}
      >
        <For each={politeToasts()}>{renderToast}</For>
      </div>
    </div>
  );
}
