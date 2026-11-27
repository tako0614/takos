import { For, Show } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { useSidebarCallbacks } from "./SidebarContext.tsx";
import type { Thread } from "../../types/index.ts";

const THREAD_BASE =
  "group flex items-center gap-1 pr-2 rounded-lg transition-colors min-h-[36px] text-sm";
const THREAD_DEFAULT =
  `${THREAD_BASE} text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/60 hover:text-zinc-800 dark:hover:text-zinc-200`;
const THREAD_ACTIVE =
  `${THREAD_BASE} bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100`;

const ACTION_BTN =
  "w-7 h-7 flex items-center justify-center rounded opacity-70 md:opacity-0 md:group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-all shrink-0";

interface ThreadListProps {
  threads: Thread[];
  selectedThreadId: string | null;
  emptyMessage?: string;
}

export function ThreadList(props: ThreadListProps) {
  const { t } = useI18n();
  const { onSelectThread, onDeleteThread, onToggleArchiveThread } =
    useSidebarCallbacks();

  const empty = () => props.emptyMessage ?? t("startConversation");

  return (
    <Show
      when={props.threads.length > 0}
      fallback={
        <div class="px-1 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
          {empty()}
        </div>
      }
    >
      <For each={props.threads}>
        {(thread) => (
          <div
            class={props.selectedThreadId === thread.id
              ? THREAD_ACTIVE
              : THREAD_DEFAULT}
          >
            <button
              type="button"
              class="flex-1 min-w-0 flex items-center gap-3 px-3 py-2 text-left rounded-lg cursor-pointer"
              onClick={() => onSelectThread(thread)}
              aria-current={props.selectedThreadId === thread.id
                ? "page"
                : undefined}
            >
              <Icons.MessageSquare class="w-4 h-4 shrink-0 opacity-70" />
              <span class="flex-1 truncate">{thread.title}</span>
            </button>
            <button
              type="button"
              class={ACTION_BTN}
              onClick={() => onToggleArchiveThread(thread)}
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
            <button
              type="button"
              class={ACTION_BTN}
              onClick={() => onDeleteThread(thread.id)}
              aria-label={t("deleteThread")}
              title={t("deleteThread")}
            >
              <Icons.Trash class="w-3 h-3" />
            </button>
          </div>
        )}
      </For>
    </Show>
  );
}
