import {
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
} from "solid-js";
import { Button } from "../../components/ui/index.ts";
import { Icons } from "../../lib/Icons.tsx";
import { formatDetailedRelativeDate } from "../../lib/format.ts";
import { apiJson } from "../../lib/rpc.ts";
import { parseRoute } from "../../hooks/router-state.ts";
import { useI18n } from "../../store/i18n.ts";
import { useNavigation } from "../../store/navigation.ts";
import { useToast } from "../../store/toast.ts";
import type { TranslationKey } from "../../store/i18n.ts";
import {
  dispatchNotificationsChanged,
  getNotificationTargetPath,
  mergeNotificationPages,
  type NotificationItem,
  notificationPageCursor,
  parseNotificationMutation,
  parseNotificationPage,
} from "./notification-response.ts";

const PAGE_SIZE = 20;

function notificationCopy(
  notification: NotificationItem,
  t: (key: TranslationKey, params?: Record<string, string | number>) => string,
): { title: string; body: string | null } {
  if (notification.type === "run.completed") {
    return {
      title: t("notificationRunCompletedTitle"),
      body: t("notificationRunCompletedBody"),
    };
  }
  if (notification.type === "run.failed") {
    return {
      title: t("notificationRunFailedTitle"),
      body: t("notificationRunFailedBody"),
    };
  }
  if (notification.type === "workspace.invite") {
    return {
      title: t("notificationLegacyWorkspaceTitle"),
      body: t("notificationLegacyWorkspaceBody"),
    };
  }
  return { title: notification.title, body: notification.body };
}

export function NotificationsPage() {
  const { t } = useI18n();
  const navigation = useNavigation();
  const { showToast } = useToast();
  const [notifications, setNotifications] = createSignal<NotificationItem[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [loadingMore, setLoadingMore] = createSignal(false);
  const [hasMore, setHasMore] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [loadMoreError, setLoadMoreError] = createSignal<string | null>(null);
  const [marking, setMarking] = createSignal<Record<string, boolean>>({});
  const [opening, setOpening] = createSignal<Record<string, boolean>>({});
  const [markingAll, setMarkingAll] = createSignal(false);
  let requestVersion = 0;
  let activeController: AbortController | null = null;

  const hasUnread = () =>
    notifications().some((notification) => notification.readAt === null);

  const loadPage = async (reset: boolean) => {
    if (reset ? loading() && requestVersion > 0 : loadingMore()) return;
    const version = ++requestVersion;
    const controller = new AbortController();
    activeController?.abort();
    activeController = controller;
    if (reset) setLoading(true);
    else setLoadingMore(true);
    if (reset) setError(null);
    setLoadMoreError(null);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      if (!reset) {
        const cursor = notificationPageCursor(notifications());
        if (!cursor) return;
        params.set("before", cursor.before);
        params.set("before_id", cursor.beforeId);
      }
      const next = parseNotificationPage(
        await apiJson<unknown>(`/api/notifications?${params.toString()}`, {
          init: { credentials: "include", signal: controller.signal },
        }),
      );
      if (version !== requestVersion) return;
      setNotifications((current) =>
        reset ? next : mergeNotificationPages(current, next)
      );
      setHasMore(next.length === PAGE_SIZE);
    } catch (loadError) {
      if (version !== requestVersion) return;
      const message =
        loadError instanceof Error && loadError.message
          ? loadError.message
          : t("notificationsLoadFailed");
      if (reset) setError(message);
      else setLoadMoreError(message);
    } finally {
      if (activeController === controller) activeController = null;
      if (version === requestVersion) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  };

  const markRead = async (notification: NotificationItem): Promise<boolean> => {
    if (notification.readAt || marking()[notification.id]) return true;
    setMarking((current) => ({ ...current, [notification.id]: true }));
    try {
      parseNotificationMutation(
        await apiJson<unknown>(
          `/api/notifications/${encodeURIComponent(notification.id)}/read`,
          { init: { method: "PATCH", credentials: "include" } },
        ),
      );
      const readAt = new Date().toISOString();
      setNotifications((current) =>
        current.map((item) =>
          item.id === notification.id ? { ...item, readAt } : item
        )
      );
      dispatchNotificationsChanged();
      return true;
    } catch (mutationError) {
      showToast(
        "error",
        mutationError instanceof Error && mutationError.message
          ? mutationError.message
          : t("notificationMarkReadFailed"),
      );
      return false;
    } finally {
      setMarking((current) => {
        const next = { ...current };
        delete next[notification.id];
        return next;
      });
    }
  };

  const openNotification = async (notification: NotificationItem) => {
    if (marking()[notification.id] || opening()[notification.id]) return;
    setOpening((current) => ({ ...current, [notification.id]: true }));
    try {
      const target = getNotificationTargetPath(notification);
      const marked = await markRead(notification);
      if (target && marked) navigation.navigate(parseRoute(target));
    } finally {
      setOpening((current) => {
        const next = { ...current };
        delete next[notification.id];
        return next;
      });
    }
  };

  const markAllRead = async () => {
    if (markingAll() || !hasUnread()) return;
    setMarkingAll(true);
    try {
      parseNotificationMutation(
        await apiJson<unknown>("/api/notifications/read-all", {
          init: { method: "PATCH", credentials: "include" },
        }),
      );
      const readAt = new Date().toISOString();
      setNotifications((current) =>
        current.map((notification) => ({ ...notification, readAt }))
      );
      dispatchNotificationsChanged();
    } catch (mutationError) {
      showToast(
        "error",
        mutationError instanceof Error && mutationError.message
          ? mutationError.message
          : t("notificationMarkAllReadFailed"),
      );
    } finally {
      setMarkingAll(false);
    }
  };

  onMount(() => void loadPage(true));
  onCleanup(() => {
    requestVersion += 1;
    activeController?.abort();
  });

  return (
    <div class="flex h-full flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-900">
      <header class="flex items-center justify-between gap-3 border-b border-zinc-200 bg-white px-4 py-3 dark:border-zinc-800 dark:bg-zinc-900">
        <div class="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            aria-label={t("goBack")}
            onClick={() => navigation.navigateToPreferredChat()}
          >
            <Icons.ArrowLeft class="h-4 w-4" />
          </Button>
          <div class="min-w-0">
            <h1 class="truncate text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {t("notificationsTitle")}
            </h1>
            <Show when={hasUnread()}>
              <p class="text-xs text-zinc-500 dark:text-zinc-400">
                {t("notificationUnreadCount", {
                  count: notifications().filter((item) => !item.readAt).length,
                })}
              </p>
            </Show>
          </div>
        </div>
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasUnread()}
          isLoading={markingAll()}
          onClick={() => void markAllRead()}
        >
          <Icons.Check class="h-4 w-4" />
          <span class="hidden sm:inline">{t("notificationMarkAllRead")}</span>
        </Button>
      </header>

      <main class="flex-1 overflow-y-auto" aria-busy={loading()}>
        <div class="mx-auto w-full max-w-3xl px-4 py-6">
          <Show when={loading()}>
            <div class="flex min-h-48 items-center justify-center" role="status">
              <Icons.Loader class="h-5 w-5 animate-spin text-zinc-500" />
              <span class="sr-only">{t("loading")}</span>
            </div>
          </Show>

          <Show when={!loading() && error()}>
            {(message) => (
              <div
                class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
                role="alert"
              >
                <p>{message()}</p>
                <Button
                  variant="secondary"
                  size="sm"
                  class="mt-3"
                  onClick={() => void loadPage(true)}
                >
                  {t("tryAgain")}
                </Button>
              </div>
            )}
          </Show>

          <Show
            when={!loading() && !error() && notifications().length > 0}
            fallback={
              <Show when={!loading() && !error()}>
                <div class="flex min-h-64 flex-col items-center justify-center text-center">
                  <div class="mb-4 rounded-full bg-zinc-100 p-3 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
                    <Icons.Bell class="h-6 w-6" />
                  </div>
                  <h2 class="font-medium text-zinc-900 dark:text-zinc-100">
                    {t("notificationsEmpty")}
                  </h2>
                  <p class="mt-1 max-w-sm text-sm text-zinc-500 dark:text-zinc-400">
                    {t("notificationsEmptyHint")}
                  </p>
                </div>
              </Show>
            }
          >
            <div class="space-y-2">
              <For each={notifications()}>
                {(notification) => {
                  const copy = () => notificationCopy(notification, t);
                  const target = () => getNotificationTargetPath(notification);
                  const interactive = () => Boolean(target() || !notification.readAt);
                  const classes = () =>
                    `relative w-full rounded-xl border p-4 text-left transition-colors ${
                      notification.readAt
                        ? "border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900"
                        : "border-blue-200 bg-blue-50/70 dark:border-blue-900 dark:bg-blue-950/20"
                    } ${interactive() ? "hover:border-zinc-400 dark:hover:border-zinc-600" : ""}`;
                  const content = () => (
                    <div class="flex gap-3">
                      <span
                        class={`mt-2 h-2 w-2 shrink-0 rounded-full ${
                          notification.readAt ? "bg-transparent" : "bg-blue-500"
                        }`}
                        aria-hidden="true"
                      />
                      <div class="min-w-0 flex-1">
                        <div class="flex items-start justify-between gap-3">
                          <h2 class="font-medium text-zinc-900 dark:text-zinc-100">
                            {copy().title}
                          </h2>
                          <time
                            class="shrink-0 text-xs text-zinc-500 dark:text-zinc-400"
                            dateTime={notification.createdAt}
                          >
                            {formatDetailedRelativeDate(notification.createdAt)}
                          </time>
                        </div>
                        <Show when={copy().body}>
                          {(body) => (
                            <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-300">
                              {body()}
                            </p>
                          )}
                        </Show>
                      </div>
                    </div>
                  );
                  return (
                    <Show
                      when={interactive()}
                      fallback={<div class={classes()}>{content()}</div>}
                    >
                      <button
                        type="button"
                        class={classes()}
                        disabled={
                          marking()[notification.id] ||
                          opening()[notification.id]
                        }
                        aria-label={t(
                          target() ? "notificationOpen" : "notificationMarkRead",
                          { title: copy().title },
                        )}
                        onClick={() => void openNotification(notification)}
                      >
                        {content()}
                      </button>
                    </Show>
                  );
                }}
              </For>
            </div>

            <Show when={loadMoreError()}>
              {(message) => (
                <div
                  class="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200"
                  role="alert"
                >
                  <span>{message()}</span>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void loadPage(false)}
                  >
                    {t("tryAgain")}
                  </Button>
                </div>
              )}
            </Show>
            <Show when={hasMore() && !loadMoreError()}>
              <div class="mt-5 flex justify-center">
                <Button
                  variant="secondary"
                  isLoading={loadingMore()}
                  onClick={() => void loadPage(false)}
                >
                  {t("loadMore")}
                </Button>
              </div>
            </Show>
          </Show>
        </div>
      </main>
    </div>
  );
}
