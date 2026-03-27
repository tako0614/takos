import { useEffect, useState } from 'react';
import { Icons } from '../../lib/Icons';
import { useI18n } from '../../providers/I18nProvider';
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

export function UnifiedSidebar({
  activeView,
  spaceId,
  spaces,
  threads,
  threadsBySpace,
  selectedThreadId,
  user,
  sidebarSpace,
}: UnifiedSidebarProps) {
  const { t } = useI18n();
  const callbacks = useSidebarCallbacks();
  const [expandedSpaceIds, setExpandedSpaceIds] = useState<Record<string, boolean>>({});

  const isNewChatActive = activeView === 'chat' && selectedThreadId === null;
  const isStorageActive = activeView === 'storage';
  const isDeployActive = DEPLOY_VIEWS.has(activeView);
  const isStoreActive = STORE_VIEWS.has(activeView);
  const isReposActive = REPOS_VIEWS.has(activeView);
  const isAppsActive = activeView === 'apps';
  const isWsSettingsActive = activeView === 'space-settings';
  const isChatActive = activeView === 'chat';

  const projectSpaces = spaces.filter((ws) => !ws.is_personal);
  const toggleSpaceAccordion = (spaceIdentifier: string) => {
    setExpandedSpaceIds((prev) => ({
      ...prev,
      [spaceIdentifier]: !prev[spaceIdentifier],
    }));
  };

  useEffect(() => {
    if (!spaceId) return;
    setExpandedSpaceIds((prev) => (prev[spaceId] ? prev : { ...prev, [spaceId]: true }));
  }, [spaceId]);

  // ── Space mode ───────────────────────────────────────────────────────────
  if (sidebarSpace !== null) {
    const wsId = getSpaceIdentifier(sidebarSpace);
    const wsThreads = threadsBySpace[wsId] ?? [];

    return (
      <nav
        className="w-[280px] bg-zinc-50 dark:bg-zinc-900 flex flex-col h-full shrink-0 border-r border-zinc-200 dark:border-zinc-800"
        role="navigation"
        aria-label="Space navigation"
      >
        {/* Header: back button + space name */}
        <div className="px-4 py-4">
          <button
            className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors text-sm font-medium"
            onClick={callbacks.onExitSpace}
          >
            <Icons.ChevronLeft className="w-4 h-4 shrink-0" />
            <span className="truncate">{sidebarSpace.name}</span>
          </button>
        </div>

        {/* Primary: Chat */}
        <div className="px-3 pb-2">
          <button
            className={isChatActive ? PRIMARY_ROW_ACTIVE : PRIMARY_ROW_DEFAULT}
            onClick={callbacks.onNavigateSpaceChat}
          >
            <Icons.MessageSquare className="w-4 h-4 shrink-0" />
            <span>{t('chat')}</span>
          </button>
        </div>

        {/* Nav items */}
        <div className="px-3 space-y-0.5">
          <button
            className={isStorageActive ? ROW_ACTIVE : ROW_DEFAULT}
            onClick={callbacks.onNavigateSpaceStorage}
          >
            <Icons.Folder className="w-4 h-4 shrink-0" />
            <span>{t('storage')}</span>
          </button>
          <button
            className={isDeployActive ? ROW_ACTIVE : ROW_DEFAULT}
            onClick={callbacks.onNavigateSpaceDeploy}
          >
            <Icons.Server className="w-4 h-4 shrink-0" />
            <span>{t('deployNav')}</span>
          </button>
          <button
            className={isReposActive ? ROW_ACTIVE : ROW_DEFAULT}
            onClick={callbacks.onNavigateSpaceRepos}
          >
            <Icons.GitBranch className="w-4 h-4 shrink-0" />
            <span>{t('repos')}</span>
          </button>
          <button
            className={isAppsActive ? ROW_ACTIVE : ROW_DEFAULT}
            onClick={callbacks.onNavigateSpaceApps}
          >
            <Icons.Grid className="w-4 h-4 shrink-0" />
            <span>{t('apps')}</span>
          </button>
        </div>

        {/* Space threads */}
        <div className="mt-6 px-4 mb-2 flex items-center justify-between">
          <span className={SECTION_LABEL}>{t('threads')}</span>
          <button
            onClick={callbacks.onNavigateSpaceChat}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label={t('newChat')}
          >
            <Icons.Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 space-y-0.5 pb-2">
          <ThreadList
            threads={wsThreads}
            selectedThreadId={selectedThreadId}
          />
        </div>

        {/* Bottom: Space Settings + profile */}
        <div className="border-t border-zinc-100 dark:border-zinc-800 p-3 space-y-0.5">
          <button
            className={isWsSettingsActive ? ROW_ACTIVE : ROW_DEFAULT}
            onClick={callbacks.onNavigateSpaceSettings}
          >
            <Icons.Settings className="w-4 h-4 shrink-0" />
            <span>{t('spaceSettings')}</span>
          </button>
          <ProfileMenu user={user} />
        </div>
      </nav>
    );
  }

  // ── Personal mode ────────────────────────────────────────────────────────────
  return (
    <nav
      className="w-[280px] bg-zinc-50 dark:bg-zinc-900 flex flex-col h-full shrink-0 border-r border-zinc-200 dark:border-zinc-800"
      role="navigation"
      aria-label="Main navigation"
    >
      <div className="px-4 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-900 dark:text-zinc-100 font-semibold text-lg">
          <img src="/logo.png" alt="takos" className="w-6 h-6 rounded" />
          <span>takos</span>
        </div>
      </div>

      <div className="px-3 pb-2 space-y-1">
        <button
          className={isAppsActive ? PRIMARY_ROW_ACTIVE : PRIMARY_ROW_DEFAULT}
          onClick={callbacks.onNavigateApps}
        >
          <Icons.Grid className="w-4 h-4 shrink-0" />
          <span>{t('apps')}</span>
        </button>
        <button
          className={isNewChatActive ? ROW_ACTIVE : ROW_DEFAULT}
          onClick={callbacks.onNewChat}
        >
          <Icons.Edit className="w-4 h-4 shrink-0" />
          <span>{t('newChat')}</span>
        </button>
      </div>

      <div className="px-3 space-y-0.5">
        <button
          className={ROW_DEFAULT}
          onClick={callbacks.onOpenSearch}
        >
          <Icons.Search className="w-4 h-4 shrink-0" />
          <span>{t('search')}</span>
        </button>
        <button
          className={isStorageActive ? ROW_ACTIVE : ROW_DEFAULT}
          onClick={callbacks.onNavigateStorage}
        >
          <Icons.Folder className="w-4 h-4 shrink-0" />
          <span>{t('storage')}</span>
        </button>
        <button
          className={isStoreActive ? ROW_ACTIVE : ROW_DEFAULT}
          onClick={callbacks.onNavigateStore}
        >
          <Icons.ShoppingBag className="w-4 h-4 shrink-0" />
          <span>{t('store')}</span>
        </button>
      </div>

      <div className="mt-6 px-4 mb-2 flex items-center justify-between">
        <span className={SECTION_LABEL}>{t('projects')}</span>
        <button onClick={callbacks.onCreateSpace} className="text-zinc-500 hover:text-zinc-300 transition-colors" aria-label={t('createSpace')}>
          <Icons.Plus className="w-4 h-4" />
        </button>
      </div>
      <div className="px-3 space-y-0.5">
        {projectSpaces.length === 0 ? (
          <div className="px-1 py-2 text-xs text-zinc-500 dark:text-zinc-400">
            {t('noProjects')}
          </div>
        ) : (
          projectSpaces.map((ws) => {
            const id = getSpaceIdentifier(ws);
            const active = id === spaceId;
            const isExpanded = expandedSpaceIds[id] ?? false;
            const spaceThreads = threadsBySpace[id] ?? [];
            return (
              <div key={ws.slug} className="space-y-1">
                <div className="group relative">
                  <button
                    className={active ? ROW_ACTIVE : ROW_DEFAULT}
                    onClick={() => callbacks.onEnterSpace(ws)}
                  >
                    <Icons.Folder className="w-4 h-4 shrink-0 opacity-70" />
                    <span className="flex-1 truncate text-left">{ws.name}</span>
                  </button>
                  <button
                    className="absolute right-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSpaceAccordion(id);
                    }}
                    aria-label={isExpanded ? t('collapseThreads') : t('expandThreads')}
                    aria-expanded={isExpanded}
                    title={isExpanded ? t('collapseThreads') : t('expandThreads')}
                  >
                    <Icons.ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      callbacks.onOpenSpaceSettings(id);
                    }}
                    aria-label={t('spaceSettings')}
                    title={t('spaceSettings')}
                  >
                    <Icons.Settings className="w-3 h-3" />
                  </button>
                </div>
                {isExpanded && (
                  <div className="ml-6 space-y-0.5">
                    {spaceThreads.length === 0 ? (
                      <div className="px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {t('noThreadsYet')}
                      </div>
                    ) : (
                      spaceThreads.map((thread) => (
                        <button
                          key={thread.id}
                          className={
                            selectedThreadId === thread.id
                              ? 'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                              : 'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors'
                          }
                          onClick={() => callbacks.onSelectThread(thread)}
                        >
                          <Icons.MessageSquare className="w-3 h-3 shrink-0 opacity-70" />
                          <span className="truncate text-left">{thread.title}</span>
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      <div className="mt-6 px-4 mb-2">
        <span className={SECTION_LABEL}>{t('threads')}</span>
      </div>
      <div className="flex-1 overflow-y-auto px-3 space-y-0.5 pb-2">
        <ThreadList
          threads={threads}
          selectedThreadId={selectedThreadId}
        />
      </div>

      <div className="border-t border-zinc-100 dark:border-zinc-800 p-3 space-y-0.5">
        <button
          className={isDeployActive ? ROW_ACTIVE : ROW_DEFAULT}
          onClick={callbacks.onNavigateDeploy}
        >
          <Icons.Server className="w-4 h-4 shrink-0" />
          <span>{t('deployNav')}</span>
        </button>
        <button
          className={isReposActive ? ROW_ACTIVE : ROW_DEFAULT}
          onClick={callbacks.onNavigateRepos}
        >
          <Icons.GitBranch className="w-4 h-4 shrink-0" />
          <span>{t('repos')}</span>
        </button>
        <button className={ROW_DEFAULT} onClick={callbacks.onOpenAgentModal}>
          <Icons.Sparkles className="w-4 h-4 shrink-0" />
          <span>{t('agentSettings')}</span>
        </button>
        <ProfileMenu user={user} />
      </div>
    </nav>
  );
}
