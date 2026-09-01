import { For, Show } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { getSpaceIdentifier } from "../../lib/spaces.ts";
import { useSidebarCallbacks } from "./SidebarContext.tsx";
import { ThreadList } from "./ThreadList.tsx";
import { ProfileMenu } from "./ProfileMenu.tsx";
import { NotificationNavigationButton } from "./NotificationNavigationButton.tsx";
import {
  getThreadLifecyclePermissions,
} from "../../lib/workspace-permissions.ts";
import type { Space, Thread, User, View } from "../../types/index.ts";

const ROW_BASE =
  "w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors min-h-[36px]";
const ROW_DEFAULT = `${ROW_BASE} text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100`;
const ROW_ACTIVE = `${ROW_BASE} bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100`;

const PRIMARY_ROW_BASE =
  "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors";
const PRIMARY_ROW_DEFAULT = `${PRIMARY_ROW_BASE} text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100`;
const PRIMARY_ROW_ACTIVE = `${PRIMARY_ROW_BASE} bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100`;

const SECTION_LABEL = "text-xs font-medium text-zinc-500 dark:text-zinc-400";

export interface UnifiedSidebarProps {
  activeView: View;
  spaceId: string | null;
  spaces: Space[];
  threads: Thread[];
  threadsBySpace: Record<string, Thread[]>;
  threadInventoryTruncatedBySpace: Record<string, boolean>;
  threadInventoryFailedBySpace: Record<string, boolean>;
  threadInventoryLoading: boolean;
  selectedThreadId: string | null;
  user: User | null;
  sidebarSpace: Space | null;
}

export function UnifiedSidebar(props: UnifiedSidebarProps) {
  const { t } = useI18n();
  const callbacks = useSidebarCallbacks();

  const isNewChatActive = () =>
    props.activeView === "chat" && props.selectedThreadId === null;
  const isMemoryActive = () => props.activeView === "memory";
  const isNotificationsActive = () => props.activeView === "notifications";
  const isConnectionsActive = () => props.activeView === "connections";
  const isWsSettingsActive = () => props.activeView === "space-settings";
  const isChatActive = () => props.activeView === "chat";

  const categorySpaces = () => props.spaces.filter((ws) => !ws.is_default);
  const canArchiveThread = (thread: Thread) =>
    getThreadLifecyclePermissions(props.spaces, thread).canArchive;
  const canDeleteThread = (thread: Thread) =>
    getThreadLifecyclePermissions(props.spaces, thread).canDelete;

  // ── Space mode ───────────────────────────────────────────────────────────
  return (
    <Show
      when={props.sidebarSpace === null}
      fallback={(() => {
        const ws = () => props.sidebarSpace!;
        const wsId = () => getSpaceIdentifier(ws());
        const wsThreads = () => props.threadsBySpace[wsId()] ?? [];
        const wsThreadsTruncated = () =>
          props.threadInventoryTruncatedBySpace[wsId()] ?? false;
        const wsThreadsFailed = () =>
          props.threadInventoryFailedBySpace[wsId()] ?? false;

        return (
          <nav
            class="w-[280px] bg-zinc-50 dark:bg-zinc-900 flex flex-col h-full shrink-0 border-r border-zinc-200 dark:border-zinc-800"
            role="navigation"
            aria-label={t("categoryNavigation")}
          >
            {/* Header: back button + space name */}
            <div class="px-4 py-4">
              <button
                type="button"
                class="flex items-center gap-2 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors text-sm font-medium"
                onClick={callbacks.onExitSpace}
              >
                <Icons.ChevronLeft class="w-4 h-4 shrink-0" />
                <span class="truncate">{ws().name}</span>
              </button>
            </div>

            {/* Primary: Chat */}
            <div class="px-3 pb-2">
              <button
                type="button"
                class={
                  isChatActive() ? PRIMARY_ROW_ACTIVE : PRIMARY_ROW_DEFAULT
                }
                onClick={callbacks.onNavigateSpaceChat}
              >
                <Icons.MessageSquare class="w-4 h-4 shrink-0" />
                <span>{t("chat")}</span>
              </button>
            </div>

            {/* Nav items */}
            <div class="px-3 space-y-0.5">
              <button
                type="button"
                class={isMemoryActive() ? ROW_ACTIVE : ROW_DEFAULT}
                onClick={callbacks.onNavigateMemory}
              >
                <Icons.Database class="w-4 h-4 shrink-0" />
                <span>{t("memory")}</span>
              </button>
              <button
                type="button"
                class={isConnectionsActive() ? ROW_ACTIVE : ROW_DEFAULT}
                onClick={callbacks.onNavigateSpaceConnections}
              >
                <Icons.Link class="w-4 h-4 shrink-0" />
                <span>{t("connections")}</span>
              </button>
            </div>

            {/* Space threads */}
            <div class="mt-6 px-4 mb-2 flex items-center justify-between">
              <span class={SECTION_LABEL}>{t("threads")}</span>
              <button
                type="button"
                onClick={callbacks.onNavigateSpaceChat}
                class="text-zinc-500 hover:text-zinc-300 transition-colors"
                aria-label={t("newChat")}
              >
                <Icons.Plus class="w-4 h-4" />
              </button>
            </div>
            <div class="flex-1 overflow-y-auto px-3 space-y-0.5 pb-2">
              <ThreadList
                threads={wsThreads()}
                selectedThreadId={props.selectedThreadId}
                canArchive={canArchiveThread}
                canDelete={canDeleteThread}
                truncated={wsThreadsTruncated()}
                loadFailed={wsThreadsFailed()}
                loading={props.threadInventoryLoading}
              />
            </div>

            {/* Bottom: Space Settings + profile */}
            <div class="border-t border-zinc-100 dark:border-zinc-800 p-3 space-y-0.5">
              <NotificationNavigationButton
                active={isNotificationsActive()}
                onOpen={callbacks.onNavigateNotifications}
              />
              <button
                type="button"
                class={isWsSettingsActive() ? ROW_ACTIVE : ROW_DEFAULT}
                onClick={callbacks.onNavigateSpaceSettings}
              >
                <Icons.Settings class="w-4 h-4 shrink-0" />
                <span>{t("categorySettings")}</span>
              </button>
              <ProfileMenu user={props.user} />
            </div>
          </nav>
        );
      })()}
    >
      {/* ── Personal mode ──────────────────────────────────────────────────────── */}
      <nav
        class="w-[280px] bg-zinc-50 dark:bg-zinc-900 flex flex-col h-full shrink-0 border-r border-zinc-200 dark:border-zinc-800"
        role="navigation"
        aria-label={t("mainNavigation")}
      >
        <div class="px-4 py-4 flex items-center justify-between">
          <div class="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-semibold text-lg">
            <img
              src="/logo.png"
              alt="takos"
              width="24"
              height="24"
              class="w-6 h-6 rounded"
            />
            <span>takos</span>
          </div>
        </div>

        <div class="px-3 pb-2 space-y-1">
          <button
            type="button"
            class={isNewChatActive() ? PRIMARY_ROW_ACTIVE : PRIMARY_ROW_DEFAULT}
            onClick={callbacks.onNewChat}
          >
            <Icons.Edit class="w-4 h-4 shrink-0" />
            <span>{t("newChat")}</span>
          </button>
          <button
            type="button"
            class={isMemoryActive() ? ROW_ACTIVE : ROW_DEFAULT}
            onClick={callbacks.onNavigateMemory}
          >
            <Icons.Database class="w-4 h-4 shrink-0" />
            <span>{t("memory")}</span>
          </button>
          <button
            type="button"
            class={isConnectionsActive() ? ROW_ACTIVE : ROW_DEFAULT}
            onClick={callbacks.onNavigateConnections}
          >
            <Icons.Link class="w-4 h-4 shrink-0" />
            <span>{t("connections")}</span>
          </button>
        </div>

        <div class="px-3 space-y-0.5">
          <button
            type="button"
            class={ROW_DEFAULT}
            onClick={callbacks.onOpenSearch}
          >
            <Icons.Search class="w-4 h-4 shrink-0" />
            <span>{t("search")}</span>
          </button>
        </div>

        <div class="mt-6 px-4 mb-2 flex items-center justify-between">
          <span class={SECTION_LABEL}>{t("categories")}</span>
          <button
            type="button"
            onClick={callbacks.onCreateSpace}
            class="text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label={t("createCategory")}
          >
            <Icons.Plus class="w-4 h-4" />
          </button>
        </div>
        <div class="px-3 space-y-0.5">
          <Show
            when={categorySpaces().length > 0}
            fallback={
              <div class="px-1 py-2 text-xs text-zinc-500 dark:text-zinc-400">
                {t("noCategories")}
              </div>
            }
          >
            <For each={categorySpaces()}>
              {(ws) => {
                const id = getSpaceIdentifier(ws);
                const active = () => id === props.spaceId;
                return (
                  <div class="group relative">
                    <button
                      type="button"
                      class={active() ? ROW_ACTIVE : ROW_DEFAULT}
                      onClick={() => callbacks.onEnterSpace(ws)}
                    >
                      <Icons.Folder class="w-4 h-4 shrink-0 opacity-70" />
                      <span class="flex-1 truncate pr-7 text-left">
                        {ws.name}
                      </span>
                    </button>
                    <button
                      type="button"
                      class="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        callbacks.onOpenSpaceSettings(id);
                      }}
                      aria-label={t("categorySettings")}
                      title={t("categorySettings")}
                    >
                      <Icons.Settings class="w-3 h-3" />
                    </button>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>

        <div class="mt-6 px-4 mb-2">
          <span class={SECTION_LABEL}>{t("threads")}</span>
        </div>
        <div class="flex-1 overflow-y-auto px-3 space-y-0.5 pb-2">
          <ThreadList
            threads={props.threads}
            selectedThreadId={props.selectedThreadId}
            canArchive={canArchiveThread}
            canDelete={canDeleteThread}
            truncated={Object.values(
              props.threadInventoryTruncatedBySpace,
            ).some(Boolean)}
            loadFailed={Object.values(
              props.threadInventoryFailedBySpace,
            ).some(Boolean)}
            loading={props.threadInventoryLoading}
          />
        </div>

        <div class="border-t border-zinc-100 dark:border-zinc-800 p-3 space-y-0.5">
          <NotificationNavigationButton
            active={isNotificationsActive()}
            onOpen={callbacks.onNavigateNotifications}
          />
          <button
            type="button"
            class={ROW_DEFAULT}
            onClick={callbacks.onOpenAgentModal}
          >
            <Icons.Sparkles class="w-4 h-4 shrink-0" />
            <span>{t("agentSettings")}</span>
          </button>
          <ProfileMenu user={props.user} />
        </div>
      </nav>
    </Show>
  );
}
