import { Show } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";

interface ChatErrorBannerProps {
  error: string;
  onDismiss: () => void;
  onRetry?: () => void;
}

export function ChatErrorBanner(props: ChatErrorBannerProps) {
  const { t } = useI18n();
  return (
    <div
      role="alert"
      class="flex items-center gap-2 mx-4 mb-2 px-4 py-2 rounded-lg bg-zinc-100 dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 text-zinc-800 dark:text-zinc-200"
    >
      <Icons.AlertTriangle class="w-5 h-5 text-zinc-600 dark:text-zinc-400 flex-shrink-0" />
      <span class="flex-1 text-sm">{props.error}</span>
      <Show when={props.onRetry}>
        <button
          type="button"
          class="rounded-lg border border-zinc-300 dark:border-zinc-600 px-3 py-2 text-sm"
          onClick={() => props.onRetry?.()}
        >
          {t("retry")}
        </button>
      </Show>
      <button
        type="button"
        class="p-1 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors text-zinc-600 dark:text-zinc-400"
        onClick={props.onDismiss}
        title={t("close")}
        aria-label={t("close")}
      >
        <Icons.X />
      </button>
    </div>
  );
}
