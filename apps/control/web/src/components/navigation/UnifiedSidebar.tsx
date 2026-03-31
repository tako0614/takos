import { createSignal, createEffect, Show, For } from 'solid-js';
import { Icons } from '../../lib/Icons';
import { useI18n } from '../../store/i18n';
import { getSpaceIdentifier } from '../../lib/spaces';
import { useSidebarCallbacks } from './SidebarContext';
import { ThreadList } from './ThreadList';
import { ProfileMenu } from './ProfileMenu';
import type { Thread, User, View, Space } from '../../types';

const ROW_BASE =
  'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors min-h-[36px]';
const ROW_DEFAULT = `${ROW_BASE} text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100`;
const ROW_ACTIVE = `${ROW_BASE} bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100`;

const PRIMARY_ROW_BASE =
  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors';
const PRIMARY_ROW_DEFAULT = `${PRIMARY_ROW_BASE} text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100`;
const PRIMARY_ROW_ACTIVE = `${PRIMARY_ROW_BASE} bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100`;

const SECTION_LABEL = 'text-xs font-medium text-zinc-500 dark:text-zinc-400';

const STORE_VIEWS = new Set(['store']);
const REPOS_VIEWS = new Set(['repos']);
const DEPLOY_VIEWS = new Set(['deploy']);

export interface UnifiedSidebarProps {
  activeView: View;
  spaceId: string | null;
  spaces: Space[];
  threads: Thread[];
  threadsBySpace: Record<string, Thread[]>;
  selectedThreadId: string | null;
  user: User | null;
  sidebarSpace: Space | null;
}

export function UnifiedSidebar(props: UnifiedSidebarProps) {
  const { t } = useI18n();
  const callbacks = useSidebarCallbacks();
  const [expandedSpaceIds, setExpandedSpaceIds] = createSignal<Record<string, boolean>>({});

  const isNewChatActive = () => props.activeView === 'chat' && props.selectedThreadId === null;
  const isStorageActive = () => props.activeView === 'storage';
  const isDeployActive = () => DEPLOY_VIEWS.has(props.activeView);
  const isStoreActive = () => STORE_VIEWS.has(props.activeView);
  const isReposActive = () => REPOS_VIEWS.has(props.activeView);
  const isAppsActive = () => props.activeView === 'apps';
  const isWsSettingsActive = () => props.activeView === 'space-settings';
  const isChatActive = () => props.activeView === 'chat';

  const projectSpaces = () => props.spaces.filter((ws) => !ws.is_personal);
  const toggleSpaceAccordion = (spaceIdentifier: string) => {
    setExpandedSpaceIds((prev) => ({
      ...prev,
      [spaceIdentifier]: !prev[spaceIdentifier],
    }));
  };

  createEffect(() => {
    const sid = props.spaceId;
    if (!sid) return;
    setExpandedSpaceIds((prev) => (prev[sid] ? prev : { ...prev, [sid]: true }));
  });

  // ── Space mode ───────────────────────────────────────────────────────────
  return (
    <Show when={props.sidebarSpace === null} fallback={
      (() => {
        const ws = () => props.sidebarSpace!;
        const wsId = () => getSpaceIdentifier(ws());
        const wsThreads = () => props.threadsBySpace[wsId()] ?? [];

        return (
          <nav
            class="w-[280px] bg-zinc-50 dark:bg-zinc-900 flex flex-col h-full shrink-0 border-r border-zinc-200 dark:border-zinc-800"
            role="navigation"
            aria-label="Space navigation"
          >
            {/* Header: back button + space name */}
            <div class="px-4 py-4">
              <button
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
                class={isChatActive() ? PRIMARY_ROW_ACTIVE : PRIMARY_ROW_DEFAULT}
                onClick={callbacks.onNavigateSpaceChat}
              >
                <Icons.MessageSquare class="w-4 h-4 shrink-0" />
                <span>{t('chat')}</span>
              </button>
            </div>

            {/* Nav items */}
            <div class="px-3 space-y-0.5">
              <button
                class={isStorageActive() ? ROW_ACTIVE : ROW_DEFAULT}
                onClick={callbacks.onNavigateSpaceStorage}
              >
                <Icons.Folder class="w-4 h-4 shrink-0" />
                <span>{t('storage')}</span>
              </button>
              <button
                class={isDeployActive() ? ROW_ACTIVE : ROW_DEFAULT}
                onClick={callbacks.onNavigateSpaceDeploy}
              >
                <Icons.Server class="w-4 h-4 shrink-0" />
                <span>{t('deployNav')}</span>
              </button>
              <button
                class={isReposActive() ? ROW_ACTIVE : ROW_DEFAULT}
                onClick={callbacks.onNavigateSpaceRepos}
              >
                <Icons.GitBranch class="w-4 h-4 shrink-0" />
                <span>{t('repos')}</span>
              </button>
              <button
                class={isAppsActive() ? ROW_ACTIVE : ROW_DEFAULT}
                onClick={callbacks.onNavigateSpaceApps}
              >
                <Icons.Grid class="w-4 h-4 shrink-0" />
                <span>{t('apps')}</span>
              </button>
            </div>

            {/* Space threads */}
            <div class="mt-6 px-4 mb-2 flex items-center justify-between">
              <span class={SECTION_LABEL}>{t('threads')}</span>
              <button
                onClick={callbacks.onNavigateSpaceChat}
                class="text-zinc-500 hover:text-zinc-300 transition-colors"
                aria-label={t('newChat')}
              >
                <Icons.Plus class="w-4 h-4" />
              </button>
            </div>
            <div class="flex-1 overflow-y-auto px-3 space-y-0.5 pb-2">
              <ThreadList
                threads={wsThreads()}
                selectedThreadId={props.selectedThreadId}
              />
            </div>

            {/* Bottom: Space Settings + profile */}
            <div class="border-t border-zinc-100 dark:border-zinc-800 p-3 space-y-0.5">
              <button
                class={isWsSettingsActive() ? ROW_ACTIVE : ROW_DEFAULT}
                onClick={callbacks.onNavigateSpaceSettings}
              >
                <Icons.Settings class="w-4 h-4 shrink-0" />
                <span>{t('spaceSettings')}</span>
              </button>
              <ProfileMenu user={props.user} />
            </div>
          </nav>
        );
      })()
    }>
      {/* ── Personal mode ──────────────────────────────────────────────────────── */}
      <nav
        class="w-[280px] bg-zinc-50 dark:bg-zinc-900 flex flex-col h-full shrink-0 border-r border-zinc-200 dark:border-zinc-800"
        role="navigation"
        aria-label="Main navigation"
      >
        <div class="px-4 py-4 flex items-center justify-between">
          <div class="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-semibold text-lg">
            <img src="/logo.png" alt="takos" class="w-6 h-6 rounded" />
            <span>takos</span>
          </div>
        </div>

        <div class="px-3 pb-2 space-y-1">
          <button
            class={isAppsActive() ? PRIMARY_ROW_ACTIVE : PRIMARY_ROW_DEFAULT}
            onClick={callbacks.onNavigateApps}
          >
            <Icons.Grid class="w-4 h-4 shrink-0" />
            <span>{t('apps')}</span>
          </button>
          <button
            class={isNewChatActive() ? ROW_ACTIVE : ROW_DEFAULT}
            onClick={callbacks.onNewChat}
          >
            <Icons.Edit class="w-4 h-4 shrink-0" />
            <span>{t('newChat')}</span>
          </button>
        </div>

        <div class="px-3 space-y-0.5">
          <button
            class={ROW_DEFAULT}
            onClick={callbacks.onOpenSearch}
          >
            <Icons.Search class="w-4 h-4 shrink-0" />
            <span>{t('search')}</span>
          </button>
          <button
            class={isStorageActive() ? ROW_ACTIVE : ROW_DEFAULT}
            onClick={callbacks.onNavigateStorage}
          >
            <Icons.Folder class="w-4 h-4 shrink-0" />
            <span>{t('storage')}</span>
          </button>
          <button
            class={isStoreActive() ? ROW_ACTIVE : ROW_DEFAULT}
            onClick={callbacks.onNavigateStore}
          >
            <Icons.ShoppingBag class="w-4 h-4 shrink-0" />
            <span>{t('store')}</span>
          </button>
        </div>

        <div class="mt-6 px-4 mb-2 flex items-center justify-between">
          <span class={SECTION_LABEL}>{t('projects')}</span>
          <button onClick={callbacks.onCreateSpace} class="text-zinc-500 hover:text-zinc-300 transition-colors" aria-label={t('createSpace')}>
            <Icons.Plus class="w-4 h-4" />
          </button>
        </div>
        <div class="px-3 space-y-0.5">
          <Show when={projectSpaces().length > 0} fallback={
            <div class="px-1 py-2 text-xs text-zinc-500 dark:text-zinc-400">
              {t('noProjects')}
            </div>
          }>
            <For each={projectSpaces()}>{(ws) => {
              const id = getSpaceIdentifier(ws);
              const active = () => id === props.spaceId;
              const isExpanded = () => expandedSpaceIds()[id] ?? false;
              const spaceThreads = () => props.threadsBySpace[id] ?? [];
              return (
                <div class="space-y-1">
                  <div class="group relative">
                    <button
                      class={active() ? ROW_ACTIVE : ROW_DEFAULT}
                      onClick={() => callbacks.onEnterSpace(ws)}
                    >
                      <Icons.Folder class="w-4 h-4 shrink-0 opacity-70" />
                      <span class="flex-1 truncate text-left">{ws.name}</span>
                    </button>
                    <button
                      class="absolute right-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleSpaceAccordion(id);
                      }}
                      aria-label={isExpanded() ? t('collapseThreads') : t('expandThreads')}
                      aria-expanded={isExpanded()}
                      title={isExpanded() ? t('collapseThreads') : t('expandThreads')}
                    >
                      <Icons.ChevronDown class={`w-3 h-3 transition-transform ${isExpanded() ? 'rotate-180' : ''}`} />
                    </button>
                    <button
                      class="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-all"
                      onClick={(e) => {
                        e.stopPropagation();
                        callbacks.onOpenSpaceSettings(id);
                      }}
                      aria-label={t('spaceSettings')}
                      title={t('spaceSettings')}
                    >
                      <Icons.Settings class="w-3 h-3" />
                    </button>
                  </div>
                  <Show when={isExpanded()}>
                    <div class="ml-6 space-y-0.5">
                      <Show when={spaceThreads().length > 0} fallback={
                        <div class="px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                          {t('noThreadsYet')}
                        </div>
                      }>
                        <For each={spaceThreads()}>{(thread) => (
                          <button
                            class={
                              props.selectedThreadId === thread.id
                                ? 'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                                : 'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors'
                            }
                            onClick={() => callbacks.onSelectThread(thread)}
                          >
                            <Icons.MessageSquare class="w-3 h-3 shrink-0 opacity-70" />
                            <span class="truncate text-left">{thread.title}</span>
                          </button>
                        )}</For>
                      </Show>
                    </div>
                  </Show>
                </div>
              );
            }}</For>
          </Show>
        </div>

        <div class="mt-6 px-4 mb-2">
          <span class={SECTION_LABEL}>{t('threads')}</span>
        </div>
        <div class="flex-1 overflow-y-auto px-3 space-y-0.5 pb-2">
          <ThreadList
            threads={props.threads}
            selectedThreadId={props.selectedThreadId}
          />
        </div>

        <div class="border-t border-zinc-100 dark:border-zinc-800 p-3 space-y-0.5">
          <button
            class={isDeployActive() ? ROW_ACTIVE : ROW_DEFAULT}
            onClick={callbacks.onNavigateDeploy}
          >
            <Icons.Server class="w-4 h-4 shrink-0" />
            <span>{t('deployNav')}</span>
          </button>
          <button
            class={isReposActive() ? ROW_ACTIVE : ROW_DEFAULT}
            onClick={callbacks.onNavigateRepos}
          >
            <Icons.GitBranch class="w-4 h-4 shrink-0" />
            <span>{t('repos')}</span>
          </button>
          <button class={ROW_DEFAULT} onClick={callbacks.onOpenAgentModal}>
            <Icons.Sparkles class="w-4 h-4 shrink-0" />
            <span>{t('agentSettings')}</span>
          </button>
          <ProfileMenu user={props.user} />
        </div>
      </nav>
    </Show>
  );
}
