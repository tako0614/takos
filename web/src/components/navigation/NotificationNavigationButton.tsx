import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { apiJson } from "../../lib/rpc.ts";
import { useI18n } from "../../store/i18n.ts";
import { parseUnreadCount } from "../../views/notifications/notification-response.ts";

const ROW_BASE =
  "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors min-h-[36px]";
const ROW_DEFAULT =
  `${ROW_BASE} text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100`;
const ROW_ACTIVE =
  `${ROW_BASE} bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100`;

export function NotificationNavigationButton(props: {
  active: boolean;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const [unreadCount, setUnreadCount] = createSignal<number | null>(null);
  let loading = false;
  let disposed = false;
  let activeController: AbortController | null = null;

  const refresh = async () => {
    if (loading || disposed) return;
    loading = true;
    const controller = new AbortController();
    activeController?.abort();
    activeController = controller;
    try {
      const count = parseUnreadCount(
        await apiJson<unknown>("/api/notifications/unread-count", {
          init: { credentials: "include", signal: controller.signal },
        }),
      );
      if (!disposed && activeController === controller) setUnreadCount(count);
    } catch {
      // Keep the last proved count. The notification page owns visible errors.
    } finally {
      if (activeController === controller) activeController = null;
      loading = false;
    }
  };

  onMount(() => {
    const handleRefresh = () => void refresh();
    void refresh();
    globalThis.addEventListener("focus", handleRefresh);
    globalThis.addEventListener("takos:notifications-changed", handleRefresh);
    const interval = globalThis.setInterval(handleRefresh, 60_000);
    onCleanup(() => {
      disposed = true;
      activeController?.abort();
      globalThis.clearInterval(interval);
      globalThis.removeEventListener("focus", handleRefresh);
      globalThis.removeEventListener(
        "takos:notifications-changed",
        handleRefresh,
      );
    });
  });

  const badge = () => {
    const count = unreadCount();
    if (!count) return null;
    return count > 99 ? "99+" : String(count);
  };

  return (
    <button
      type="button"
      class={props.active ? ROW_ACTIVE : ROW_DEFAULT}
      onClick={props.onOpen}
      aria-label={
        unreadCount()
          ? `${t("notifications")}: ${
            t("notificationUnreadCount", { count: unreadCount()! })
          }`
          : t("notifications")
      }
    >
      <Icons.Bell class="h-4 w-4 shrink-0" />
      <span>{t("notifications")}</span>
      <Show when={badge()}>
        {(count) => (
          <span
            class="ml-auto min-w-5 rounded-full bg-blue-600 px-1.5 py-0.5 text-center text-[10px] font-semibold leading-none text-white"
            aria-hidden="true"
          >
            {count()}
          </span>
        )}
      </Show>
    </button>
  );
}
