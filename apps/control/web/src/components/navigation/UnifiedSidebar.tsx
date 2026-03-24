import { useEffect, useState } from 'react';
import { Icons } from '../../lib/Icons';
import { useI18n } from '../../providers/I18nProvider';
import { getWorkspaceIdentifier } from '../../lib/workspaces';
import type { Thread, User, View, Workspace } from '../../types';

const ROW_BASE =
  'w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors min-h-[36px]';
const ROW_DEFAULT = `${ROW_BASE} text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100`;
const ROW_ACTIVE = `${ROW_BASE} bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100`;

const THREAD_BASE = 'group flex items-center gap-3 px-3 py-2 rounded-lg cursor-pointer transition-colors min-h-[36px] text-sm';
const THREAD_DEFAULT = `${THREAD_BASE} text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/60 hover:text-zinc-800 dark:hover:text-zinc-200`;
const THREAD_ACTIVE = `${THREAD_BASE} bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100`;
const PRIMARY_ROW_BASE =
  'w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors';
const PRIMARY_ROW_DEFAULT = `${PRIMARY_ROW_BASE} text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 hover:text-zinc-900 dark:hover:text-zinc-100`;
const PRIMARY_ROW_ACTIVE = `${PRIMARY_ROW_BASE} bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100`;

const ACTION_BTN =
  'w-6 h-6 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-all shrink-0';

const SECTION_LABEL = 'text-xs font-medium text-zinc-500 dark:text-zinc-400';

const STORE_VIEWS = new Set(['store']);
const REPOS_VIEWS = new Set(['repos']);
const DEPLOY_VIEWS = new Set(['deploy']);

const PROFILE_MENU_BTN =
  'flex items-center gap-2 w-full px-4 py-2 text-left text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-700 transition-colors min-h-[36px]';

export interface UnifiedSidebarProps {
  activeView: View;
  onNewChat: () => void;
  onNavigateStorage: () => void;
  onNavigateDeploy: () => void;
  onNavigateApps: () => void;
  onNavigateStore: () => void;
  onNavigateRepos: () => void;
  onOpenSearch: () => void;
  spaceId: string | null;
  workspaces: Workspace[];
  onCreateWorkspace: () => void;
  threads: Thread[];
  threadsByWorkspace: Record<string, Thread[]>;
  selectedThreadId: string | null;
  onSelectThread: (thread: Thread) => void;
  onDeleteThread: (threadId: string) => void;
  onToggleArchiveThread: (thread: Thread) => void;
  user: User | null;
  onOpenAgentModal: () => void;
  onOpenWorkspaceSettings: (spaceId: string) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  // Dual-mode props
  sidebarWorkspace: Workspace | null;
  onEnterWorkspace: (ws: Workspace) => void;
  onExitWorkspace: () => void;
  onNavigateWorkspaceChat: () => void;
  onNavigateWorkspaceStorage: () => void;
  onNavigateWorkspaceDeploy: () => void;
  onNavigateWorkspaceRepos: () => void;
  onNavigateWorkspaceApps: () => void;
  onNavigateWorkspaceSettings: () => void;
}

export function UnifiedSidebar({
  activeView,
  onNewChat,
  onNavigateStorage,
  onNavigateDeploy,
  onNavigateApps,
  onNavigateStore,
  onNavigateRepos,
  onOpenSearch,
  spaceId,
  workspaces,
  onCreateWorkspace,
  threads,
  threadsByWorkspace,
  selectedThreadId,
  onSelectThread,
  onDeleteThread,
  onToggleArchiveThread,
  user,
  onOpenAgentModal,
  onOpenWorkspaceSettings,
  onOpenSettings,
  onLogout,
  sidebarWorkspace,
  onEnterWorkspace,
  onExitWorkspace,
  onNavigateWorkspaceChat,
  onNavigateWorkspaceStorage,
  onNavigateWorkspaceDeploy,
  onNavigateWorkspaceRepos,
  onNavigateWorkspaceApps,
  onNavigateWorkspaceSettings,
}: UnifiedSidebarProps) {
  const { t } = useI18n();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Record<string, boolean>>({});

  const isNewChatActive = activeView === 'chat' && selectedThreadId === null;
  const isStorageActive = activeView === 'storage';
  const isDeployActive = DEPLOY_VIEWS.has(activeView);
  const isStoreActive = STORE_VIEWS.has(activeView);
  const isReposActive = REPOS_VIEWS.has(activeView);
  const isAppsActive = activeView === 'apps';
  const isWsSettingsActive = activeView === 'space-settings';
  const isChatActive = activeView === 'chat';

  useEffect(() => {
    if (!showProfileMenu) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest('.unified-profile-menu')) {
        setShowProfileMenu(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('click', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('click', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showProfileMenu]);

  const projectWorkspaces = workspaces.filter((ws) => !ws.is_personal);
  const toggleWorkspaceAccordion = (spaceIdentifier: string) => {
    setExpandedWorkspaceIds((prev) => ({
      ...prev,
      [spaceIdentifier]: !prev[spaceIdentifier],
    }));
  };

  useEffect(() => {
    if (!spaceId) return;
    setExpandedWorkspaceIds((prev) => (prev[spaceId] ? prev : { ...prev, [spaceId]: true }));
  }, [spaceId]);

  const renderProfileMenu = () => (
    <div className="relative unified-profile-menu">
      <button
        className={ROW_DEFAULT}
        onClick={(e) => {
          e.stopPropagation();
          setShowProfileMenu(!showProfileMenu);
        }}
        aria-label={t('profileMenu')}
        aria-expanded={showProfileMenu}
        aria-haspopup="menu"
      >
        {user?.picture ? (
          <img
            src={user.picture}
            alt={(user?.name || user?.username || '') + "'s avatar"}
            className="w-5 h-5 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className="w-5 h-5 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-zinc-600 dark:text-zinc-300 text-xs font-semibold shrink-0">
            {user?.name?.charAt(0).toUpperCase()}
          </div>
        )}
        <span className="truncate min-w-0 text-zinc-700 dark:text-zinc-300">
          {user?.username
            ? `@${user.username}`
            : user?.name || user?.email || '-'}
        </span>
      </button>

      {showProfileMenu && (
        <div
          className="absolute bottom-full left-0 right-0 mb-2 bg-white dark:bg-zinc-800 border border-zinc-100 dark:border-zinc-700 rounded-xl shadow-xl overflow-hidden z-50"
          onClick={(e) => e.stopPropagation()}
          role="menu"
          aria-label={t('profileMenu')}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              setShowProfileMenu(false);
            }
          }}
        >
          <div className="px-4 py-2 border-b border-zinc-100 dark:border-zinc-700">
            <span className="block text-xs font-semibold text-zinc-800 dark:text-zinc-200">
              {user?.username ? `@${user.username}` : '-'}
            </span>
            {user?.name && (
              <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {user.name}
              </span>
            )}
            {user?.email && (
              <span className="block text-xs text-zinc-500 dark:text-zinc-400 mt-0.5">
                {user.email}
              </span>
            )}
          </div>
          <button
            className={PROFILE_MENU_BTN}
            role="menuitem"
            onClick={() => {
              setShowProfileMenu(false);
              onOpenSettings();
            }}
          >
            <Icons.Settings className="w-4 h-4" />
            <span>{t('accountSettings')}</span>
          </button>
          <button
            className={PROFILE_MENU_BTN}
            role="menuitem"
            onClick={() => {
              setShowProfileMenu(false);
              onLogout();
            }}
          >
            <Icons.X className="w-4 h-4" />
            <span>{t('logout')}</span>
          </button>
        </div>
      )}
    </div>
  );

  // ── Workspace mode ───────────────────────────────────────────────────────────
  if (sidebarWorkspace !== null) {
    const wsId = getWorkspaceIdentifier(sidebarWorkspace);
    const wsThreads = threadsByWorkspace[wsId] ?? [];

    return (
      <nav
        className="w-[280px] bg-zinc-50 dark:bg-zinc-900 flex flex-col h-full shrink-0 border-r border-zinc-200 dark:border-zinc-800"
        role="navigation"
        aria-label="Workspace navigation"
      >
        {/* Header: back button + workspace name */}
        <div className="px-4 py-4">
          <button
            className="flex items-center gap-2 text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors text-sm font-medium"
            onClick={onExitWorkspace}
          >
            <Icons.ChevronLeft className="w-4 h-4 shrink-0" />
            <span className="truncate">{sidebarWorkspace.name}</span>
          </button>
        </div>

        {/* Primary: Chat */}
        <div className="px-3 pb-2">
          <button
            className={isChatActive ? PRIMARY_ROW_ACTIVE : PRIMARY_ROW_DEFAULT}
            onClick={onNavigateWorkspaceChat}
          >
            <Icons.MessageSquare className="w-4 h-4 shrink-0" />
            <span>{t('chat')}</span>
          </button>
        </div>

        {/* Nav items */}
        <div className="px-3 space-y-0.5">
          <button
            className={isStorageActive ? ROW_ACTIVE : ROW_DEFAULT}
            onClick={onNavigateWorkspaceStorage}
          >
            <Icons.Folder className="w-4 h-4 shrink-0" />
            <span>{t('storage')}</span>
          </button>
          <button
            className={isDeployActive ? ROW_ACTIVE : ROW_DEFAULT}
            onClick={onNavigateWorkspaceDeploy}
          >
            <Icons.Server className="w-4 h-4 shrink-0" />
            <span>{t('deployNav')}</span>
          </button>
          <button
            className={isReposActive ? ROW_ACTIVE : ROW_DEFAULT}
            onClick={onNavigateWorkspaceRepos}
          >
            <Icons.GitBranch className="w-4 h-4 shrink-0" />
            <span>{t('repos')}</span>
          </button>
          <button
            className={isAppsActive ? ROW_ACTIVE : ROW_DEFAULT}
            onClick={onNavigateWorkspaceApps}
          >
            <Icons.Grid className="w-4 h-4 shrink-0" />
            <span>{t('apps')}</span>
          </button>
        </div>

        {/* Workspace threads */}
        <div className="mt-6 px-4 mb-2 flex items-center justify-between">
          <span className={SECTION_LABEL}>{t('threads')}</span>
          <button
            onClick={onNavigateWorkspaceChat}
            className="text-zinc-500 hover:text-zinc-300 transition-colors"
            aria-label={t('newChat')}
          >
            <Icons.Plus className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-3 space-y-0.5 pb-2">
          {wsThreads.length === 0 ? (
            <div className="px-1 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
              {t('startConversation')}
            </div>
          ) : (
            wsThreads.map((thread) => (
              <div
                key={thread.id}
                className={selectedThreadId === thread.id ? THREAD_ACTIVE : THREAD_DEFAULT}
                onClick={() => onSelectThread(thread)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onSelectThread(thread);
                  }
                }}
              >
                <Icons.MessageSquare className="w-4 h-4 shrink-0 opacity-70" />
                <span className="flex-1 truncate">{thread.title}</span>
                <button
                  className={ACTION_BTN}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleArchiveThread(thread);
                  }}
                  aria-label={thread.status === 'archived' ? t('unarchiveThread') : t('archiveThread')}
                  title={thread.status === 'archived' ? t('unarchiveThread') : t('archiveThread')}
                >
                  {thread.status === 'archived' ? (
                    <Icons.Refresh className="w-3 h-3" />
                  ) : (
                    <Icons.Archive className="w-3 h-3" />
                  )}
                </button>
                <button
                  className={ACTION_BTN}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteThread(thread.id);
                  }}
                  aria-label={t('deleteThread')}
                  title={t('deleteThread')}
                >
                  <Icons.Trash className="w-3 h-3" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Bottom: Workspace Settings + profile */}
        <div className="border-t border-zinc-100 dark:border-zinc-800 p-3 space-y-0.5">
          <button
            className={isWsSettingsActive ? ROW_ACTIVE : ROW_DEFAULT}
            onClick={onNavigateWorkspaceSettings}
          >
            <Icons.Settings className="w-4 h-4 shrink-0" />
            <span>{t('workspaceSettings')}</span>
          </button>
          {renderProfileMenu()}
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
          onClick={onNavigateApps}
        >
          <Icons.Grid className="w-4 h-4 shrink-0" />
          <span>{t('apps')}</span>
        </button>
        <button
          className={isNewChatActive ? ROW_ACTIVE : ROW_DEFAULT}
          onClick={onNewChat}
        >
          <Icons.Edit className="w-4 h-4 shrink-0" />
          <span>{t('newChat')}</span>
        </button>
      </div>

      <div className="px-3 space-y-0.5">
        <button
          className={ROW_DEFAULT}
          onClick={onOpenSearch}
        >
          <Icons.Search className="w-4 h-4 shrink-0" />
          <span>{t('search')}</span>
        </button>
        <button
          className={isStorageActive ? ROW_ACTIVE : ROW_DEFAULT}
          onClick={onNavigateStorage}
        >
          <Icons.Folder className="w-4 h-4 shrink-0" />
          <span>{t('storage')}</span>
        </button>
        <button
          className={isStoreActive ? ROW_ACTIVE : ROW_DEFAULT}
          onClick={onNavigateStore}
        >
          <Icons.ShoppingBag className="w-4 h-4 shrink-0" />
          <span>{t('store')}</span>
        </button>
      </div>

      <div className="mt-6 px-4 mb-2 flex items-center justify-between">
        <span className={SECTION_LABEL}>{t('projects')}</span>
        <button onClick={onCreateWorkspace} className="text-zinc-500 hover:text-zinc-300 transition-colors" aria-label={t('createWorkspace')}>
          <Icons.Plus className="w-4 h-4" />
        </button>
      </div>
      <div className="px-3 space-y-0.5">
        {projectWorkspaces.length === 0 ? (
          <div className="px-1 py-2 text-xs text-zinc-500 dark:text-zinc-400">
            {t('noProjects')}
          </div>
        ) : (
          projectWorkspaces.map((ws) => {
            const id = getWorkspaceIdentifier(ws);
            const active = id === spaceId;
            const isExpanded = expandedWorkspaceIds[id] ?? false;
            const workspaceThreads = threadsByWorkspace[id] ?? [];
            return (
              <div key={ws.slug} className="space-y-1">
                <div className="group relative">
                  <button
                    className={active ? ROW_ACTIVE : ROW_DEFAULT}
                    onClick={() => onEnterWorkspace(ws)}
                  >
                    <Icons.Folder className="w-4 h-4 shrink-0 opacity-70" />
                    <span className="flex-1 truncate text-left">{ws.name}</span>
                  </button>
                  <button
                    className="absolute right-8 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 w-5 h-5 flex items-center justify-center rounded text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-600 transition-all"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleWorkspaceAccordion(id);
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
                      onOpenWorkspaceSettings(id);
                    }}
                    aria-label={t('workspaceSettings')}
                    title={t('workspaceSettings')}
                  >
                    <Icons.Settings className="w-3 h-3" />
                  </button>
                </div>
                {isExpanded && (
                  <div className="ml-6 space-y-0.5">
                    {workspaceThreads.length === 0 ? (
                      <div className="px-3 py-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                        {t('noThreadsYet')}
                      </div>
                    ) : (
                      workspaceThreads.map((thread) => (
                        <button
                          key={thread.id}
                          className={
                            selectedThreadId === thread.id
                              ? 'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                              : 'w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100/70 dark:hover:bg-zinc-800/60 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors'
                          }
                          onClick={() => onSelectThread(thread)}
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
        {threads.length === 0 ? (
          <div className="px-1 py-8 text-center text-xs text-zinc-500 dark:text-zinc-400">
            {t('startConversation')}
          </div>
        ) : (
          threads.map((thread) => (
            <div
              key={thread.id}
              className={selectedThreadId === thread.id ? THREAD_ACTIVE : THREAD_DEFAULT}
              onClick={() => onSelectThread(thread)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onSelectThread(thread);
                }
              }}
            >
              <Icons.MessageSquare className="w-4 h-4 shrink-0 opacity-70" />
              <span className="flex-1 truncate">{thread.title}</span>
              <button
                className={ACTION_BTN}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleArchiveThread(thread);
                }}
                aria-label={thread.status === 'archived' ? t('unarchiveThread') : t('archiveThread')}
                title={thread.status === 'archived' ? t('unarchiveThread') : t('archiveThread')}
              >
                {thread.status === 'archived' ? (
                  <Icons.Refresh className="w-3 h-3" />
                ) : (
                  <Icons.Archive className="w-3 h-3" />
                )}
              </button>
              <button
                className={ACTION_BTN}
                onClick={(e) => {
                  e.stopPropagation();
                  onDeleteThread(thread.id);
                }}
                aria-label={t('deleteThread')}
                title={t('deleteThread')}
              >
                <Icons.Trash className="w-3 h-3" />
              </button>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-zinc-100 dark:border-zinc-800 p-3 space-y-0.5">
        <button
          className={isDeployActive ? ROW_ACTIVE : ROW_DEFAULT}
          onClick={onNavigateDeploy}
        >
          <Icons.Server className="w-4 h-4 shrink-0" />
          <span>{t('deployNav')}</span>
        </button>
        <button
          className={isReposActive ? ROW_ACTIVE : ROW_DEFAULT}
          onClick={onNavigateRepos}
        >
          <Icons.GitBranch className="w-4 h-4 shrink-0" />
          <span>{t('repos')}</span>
        </button>
        <button className={ROW_DEFAULT} onClick={onOpenAgentModal}>
          <Icons.Sparkles className="w-4 h-4 shrink-0" />
          <span>{t('agentSettings')}</span>
        </button>
        {renderProfileMenu()}
      </div>
    </nav>
  );
}
