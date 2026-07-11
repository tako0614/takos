import { For, Show } from "solid-js";
import { Button } from "../ui/index.ts";
import { useMcpToolConfirmations } from "../../hooks/useMcpToolConfirmations.ts";
import { useI18n } from "../../store/i18n.ts";

export function McpToolConfirmationCenter(props: {
  spaceId: () => string | null;
}) {
  const { t } = useI18n();
  const confirmations = useMcpToolConfirmations(props.spaceId);

  return (
    <Show when={confirmations.confirmations().length > 0}>
      <aside
        class="fixed right-4 top-4 z-[80] grid max-h-[calc(100dvh-2rem)] w-[min(28rem,calc(100vw-2rem))] gap-3 overflow-y-auto"
        aria-label={t("mcpToolConfirmationsTitle")}
      >
        <Show when={confirmations.error()}>
          {(message) => (
            <p class="rounded-xl border border-red-300 bg-white p-3 text-xs text-red-700 shadow-xl dark:border-red-800 dark:bg-zinc-950 dark:text-red-200">
              {message()}
            </p>
          )}
        </Show>
        <For each={confirmations.confirmations()}>
          {(confirmation) => (
            <section class="rounded-xl border border-amber-300 bg-white p-4 shadow-xl dark:border-amber-800 dark:bg-zinc-950">
              <h2 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                {t("mcpToolConfirmationRequired")}
              </h2>
              <p class="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                {confirmation.server_name} · {confirmation.tool_name}
              </p>
              <p class="mt-2 text-xs text-amber-800 dark:text-amber-200">
                {t("mcpToolConfirmationRetryNotice")}
              </p>
              <details class="mt-3">
                <summary class="cursor-pointer text-xs font-medium text-zinc-700 dark:text-zinc-200">
                  {t("mcpToolConfirmationArguments")}
                </summary>
                <pre class="mt-2 max-h-48 overflow-auto rounded-lg bg-zinc-100 p-3 text-xs text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
                  {JSON.stringify(confirmation.arguments, null, 2)}
                </pre>
              </details>
              <div class="mt-4 flex justify-end gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={confirmations.busyId() === confirmation.id}
                  onClick={() =>
                    void confirmations.decide(confirmation.id, "deny")
                  }
                >
                  {t("deny")}
                </Button>
                <Button
                  size="sm"
                  isLoading={confirmations.busyId() === confirmation.id}
                  onClick={() =>
                    void confirmations.decide(confirmation.id, "approve")
                  }
                >
                  {t("approveOnce")}
                </Button>
              </div>
            </section>
          )}
        </For>
      </aside>
    </Show>
  );
}
