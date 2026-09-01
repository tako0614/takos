import { For, Show } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { useSidebarCallbacks } from "./SidebarContext.tsx";
import type { Thread } from "../../types/index.ts";

const THREAD_BASE =
  "group flex items-center gap-1 px-3 py-2 rounded-lg transition-colors min-h-[36px] text-sm";
const THREAD_DEFAULT =
  `${THREAD_BASE} text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/60 hover:text-zinc-800 dark:hover:text-zinc-200`;
const THREAD_ACTIVE =
  `${THREAD_BASE} bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100`;

const ACTION_BTN =
  "w-6 h-6 flex items-center justify-center rounded opacity-60 hover:opacity-100 focus-visible:opacity-100 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-all shrink-0";

interface ThreadListProps {
  threads: Thread[];
  selectedThreadId: string | null;
  canArchive: (thread: Thread) => boolean;
  canDelete: (thread: Thread) => boolean;
  emptyMessage?: string;
  truncated?: boolean;
  loadFailed?: boolean;
  loading?: boolean;
}

function ThreadInventoryStatus(props: { loading: boolean }) {
  const { t } = useI18n();
  const { onRetryThreads } = useSidebarCallbacks();

  return (
    <div
      role="alert"
      class="mx-1 flex items-center justify-between gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700 dark:bg-red-950/30 dark:text-red-300"
    >
      <span>{t("failedToLoad")}</span>
      <button
        type="button"
        class="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 font-medium hover:bg-red-100 disabled:cursor-wait disabled:opacity-60 dark:hover:bg-red-900/40"
        disabled={props.loading}
        onClick={onRetryThreads}
      >
        <Show when={props.loading}>
          <Icons.Loader class="h-3 w-3 animate-spin" />
        </Show>
        {t("retry")}
      </button>
    </div>
  );
}

export function ThreadList(props: ThreadListProps) {
  const { t } = useI18n();
  const {
    onSelectThread,
    onDeleteThread,
    onToggleArchiveThread,
    isThreadActionPending,
    onOpenSearch,
  } =
    useSidebarCallbacks();

  const empty = () => props.emptyMessage ?? t("startConversation");

  return (
    <>
      <Show
        when={props.threads.length > 0}
        fallback={
          <Show
            when={props.loadFailed}
            fallback={
              <div class="px-1 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
                <Show
                  when={props.loading}
                  fallback={empty()}
                >
                  <Icons.Loader class="mx-auto h-4 w-4 animate-spin" />
                  <span class="sr-only">{t("loading")}</span>
                </Show>
              </div>
            }
          >
            <ThreadInventoryStatus loading={props.loading ?? false} />
          </Show>
        }
      >
        <For each={props.threads}>
          {(thread) => {
            const pending = () => isThreadActionPending(thread.id);
            return (
              <div
                class={props.selectedThreadId === thread.id
                  ? THREAD_ACTIVE
                  : THREAD_DEFAULT}
                aria-busy={pending()}
              >
                <button
                  type="button"
                  class="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => onSelectThread(thread)}
                >
                  <Icons.MessageSquare class="w-4 h-4 shrink-0 opacity-70" />
                  <span class="flex-1 truncate">
                    {thread.title || t("untitledThread")}
                  </span>
                </button>
                <Show
                  when={!pending()}
                  fallback={
                    <Icons.Loader class="mx-1 h-3.5 w-3.5 shrink-0 animate-spin text-zinc-500" />
                  }
                >
                  <Show when={props.canArchive(thread)}>
                    <button
                      type="button"
                      class={ACTION_BTN}
                      onClick={() => void onToggleArchiveThread(thread)}
                      aria-label={thread.status === "archived"
                        ? t("unarchiveThread")
                        : t("archiveThread")}
                      title={thread.status === "archived"
                        ? t("unarchiveThread")
                        : t("archiveThread")}
                    >
                      <Show
                        when={thread.status === "archived"}
                        fallback={<Icons.Archive class="w-3 h-3" />}
                      >
                        <Icons.Refresh class="w-3 h-3" />
                      </Show>
                    </button>
                  </Show>
                  <Show when={props.canDelete(thread)}>
                    <button
                      type="button"
                      class={ACTION_BTN}
                      onClick={() => void onDeleteThread(thread.id)}
                      aria-label={t("deleteThread")}
                      title={t("deleteThread")}
                    >
                      <Icons.Trash class="w-3 h-3" />
                    </button>
                  </Show>
                </Show>
              </div>
            );
          }}
        </For>
        <Show when={props.truncated}>
          <button
            type="button"
            class="w-full px-3 py-2 text-left text-xs text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
            onClick={onOpenSearch}
          >
            {t("olderThreadsSearch")}
          </button>
        </Show>
      </Show>
      <Show when={props.threads.length > 0 && props.loadFailed}>
        <ThreadInventoryStatus loading={props.loading ?? false} />
      </Show>
    </>
  );
}
