import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getWorkspaceIdentifier, getPersonalWorkspace, findWorkspaceByIdentifier } from '../lib/workspaces';
import { rpc, rpcJson } from '../lib/rpc';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useI18n } from '../providers/I18nProvider';
import { useToast } from '../hooks/useToast';
import { useConfirmDialog } from '../providers/ConfirmDialogProvider';
import type { RouteState, Thread, Workspace } from '../types';

interface NavigationContextValue {
  // Router (single source of truth)
  route: RouteState;
  navigate: (state: Partial<RouteState>) => void;
  replace: (state: RouteState) => void;

  // Sidebar workspace mode
  sidebarWorkspace: Workspace | null;
  setSidebarWorkspace: (ws: Workspace | null) => void;
  handleEnterWorkspace: (ws: Workspace) => void;
  handleExitWorkspace: () => void;

  // Mobile drawer
  showMobileNavDrawer: boolean;
  setShowMobileNavDrawer: (show: boolean) => void;
  mobileNavDrawerId: string;

  // Thread state
  threadsByWorkspace: Record<string, Thread[]>;
  setThreadsByWorkspace: React.Dispatch<React.SetStateAction<Record<string, Thread[]>>>;
  allThreads: Thread[];
  fetchAllThreads: (wsList?: Workspace[]) => Promise<void>;
  handleNewThread: () => void;
  handleDeleteThread: (threadId: string) => Promise<void>;
  toggleArchiveThread: (thread: Thread) => Promise<void>;
  handleNewThreadCreated: (spaceId: string, thread: Thread) => void;
  handleSelectThread: (thread: Thread) => void;

  // Navigation helpers
  navigateToChat: (spaceId?: string, threadId?: string) => void;
  replaceToChat: (spaceId?: string) => void;
  navigateToPreferredChat: () => void;

  // Workspace resolution
  preferredWorkspace: Workspace | undefined;
  preferredWorkspaceId: string | undefined;
  routeWorkspaceId: string | undefined;
  selectedWorkspaceId: string | null;
  waitingForWorkspaceResolution: boolean;

  // Sidebar action wrapper (closes mobile drawer before executing)
  runSidebarAction: (action: () => void | Promise<void>) => void;
}

const NavigationContext = createContext<NavigationContextValue | null>(null);

export function useNavigation(): NavigationContextValue {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider');
  }
  return context;
}

interface NavigationProviderProps {
  children: ReactNode;
  workspaces: Workspace[];
  workspacesLoaded: boolean;
  route: RouteState;
  navigate: (state: Partial<RouteState>) => void;
  replace: (state: RouteState) => void;
}

export function NavigationProvider({ children, workspaces, workspacesLoaded, route, navigate, replace }: NavigationProviderProps) {
  const { t } = useI18n();
  const { isMobile } = useBreakpoint();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();

  const [sidebarWorkspace, setSidebarWorkspace] = useState<Workspace | null>(null);
  const [showMobileNavDrawer, setShowMobileNavDrawer] = useState(false);
  const mobileNavDrawerId = 'mobile-navigation-drawer';

  // Thread state keyed by workspace identifier
  const [threadsByWorkspace, setThreadsByWorkspace] = useState<Record<string, Thread[]>>({});
  const allThreads = useMemo(
    () => Object.values(threadsByWorkspace).flat(),
    [threadsByWorkspace],
  );

  // Workspace resolution
  const preferredWorkspace = useMemo(
    () => getPersonalWorkspace(workspaces, t('personal')) || workspaces[0],
    [workspaces, t],
  );

  const preferredWorkspaceId = useMemo(
    () => (preferredWorkspace ? getWorkspaceIdentifier(preferredWorkspace) : undefined),
    [preferredWorkspace],
  );

  const routeWorkspaceId = useMemo(() => {
    if (!route.spaceId) return undefined;
    const workspace = findWorkspaceByIdentifier(workspaces, route.spaceId, t('personal'));
    return workspace ? getWorkspaceIdentifier(workspace) : undefined;
  }, [route.spaceId, workspaces, t]);

  const selectedWorkspaceId = route.spaceId
    ? routeWorkspaceId ?? null
    : preferredWorkspaceId ?? null;
  const waitingForWorkspaceResolution = Boolean(route.spaceId) && !routeWorkspaceId && !workspacesLoaded;

  // Navigation helpers
  const navigateToChat = useCallback((spaceId?: string, threadId?: string) => {
    if (spaceId && threadId) {
      navigate({ view: 'chat', spaceId, threadId, runId: undefined, messageId: undefined });
      return;
    }
    if (spaceId) {
      navigate({ view: 'chat', spaceId, threadId: undefined, runId: undefined, messageId: undefined });
      return;
    }
    navigate({ view: 'chat', threadId: undefined, runId: undefined, messageId: undefined });
  }, [navigate]);

  const replaceToChat = useCallback((spaceId?: string) => {
    if (spaceId) {
      replace({ view: 'chat', spaceId, runId: undefined, messageId: undefined });
      return;
    }
    replace({ view: 'chat', runId: undefined, messageId: undefined });
  }, [replace]);

  const navigateToPreferredChat = useCallback(() => {
    navigateToChat(preferredWorkspaceId);
  }, [navigateToChat, preferredWorkspaceId]);

  // Sidebar workspace handlers
  const handleEnterWorkspace = useCallback((ws: Workspace) => {
    setSidebarWorkspace(ws);
    navigate({ view: 'chat', spaceId: getWorkspaceIdentifier(ws), threadId: undefined, runId: undefined, messageId: undefined });
  }, [navigate]);

  const handleExitWorkspace = useCallback(() => {
    setSidebarWorkspace(null);
    replace({ view: 'apps', spaceId: preferredWorkspaceId });
  }, [replace, preferredWorkspaceId]);

  // Thread fetching
  const fetchAllThreads = useCallback(async (wsList?: Workspace[]) => {
    const list = wsList ?? workspaces;
    if (list.length === 0) return;
    const entries = await Promise.all(
      list.map(async (ws) => {
        const identifier = getWorkspaceIdentifier(ws);
        try {
          const res = await rpc.spaces[':spaceId'].threads.$get({
            param: { spaceId: identifier },
            query: { status: 'active' },
          });
          const data = await rpcJson<{ threads: Thread[] }>(res);
          return [identifier, data.threads] as const;
        } catch {
          return [identifier, [] as Thread[]] as const;
        }
      }),
    );
    setThreadsByWorkspace(Object.fromEntries(entries));
  }, [workspaces]);

  // Thread CRUD
  const handleNewThread = useCallback(() => {
    if (!preferredWorkspaceId) return;
    navigateToChat(preferredWorkspaceId);
  }, [preferredWorkspaceId, navigateToChat]);

  const handleDeleteThread = useCallback(async (threadId: string) => {
    const confirmed = await confirm({
      title: t('confirmDelete'),
      message: t('confirmDeleteThread'),
      confirmText: t('delete'),
      danger: true,
    });
    if (!confirmed) return;

    try {
      const res = await rpc.threads[':id'].$delete({ param: { id: threadId } });
      await rpcJson(res);
      setThreadsByWorkspace((prev) => {
        const next: Record<string, Thread[]> = {};
        for (const key of Object.keys(prev)) {
          next[key] = prev[key].filter((th) => th.id !== threadId);
        }
        return next;
      });
      if (route.threadId === threadId) {
        navigateToChat(selectedWorkspaceId ?? undefined);
      }
      showToast('success', t('deleted'));
    } catch {
      showToast('error', t('failedToDelete'));
    }
  }, [confirm, t, showToast, route.threadId, selectedWorkspaceId, navigateToChat]);

  const toggleArchiveThread = useCallback(async (thread: Thread) => {
    try {
      const endpoint = thread.status === 'archived' ? 'unarchive' : 'archive';
      const res = await (endpoint === 'archive'
        ? rpc.threads[':id'].archive.$post({ param: { id: thread.id } })
        : rpc.threads[':id'].unarchive.$post({ param: { id: thread.id } })
      );
      await rpcJson(res);
      await fetchAllThreads();
      showToast('success', endpoint === 'archive' ? (t('routingStatus_archived') || 'Archived') : (t('routingStatus_active') || 'Active'));
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : t('failedToSave'));
    }
  }, [fetchAllThreads, showToast, t]);

  const handleNewThreadCreated = useCallback((spaceId: string, thread: Thread) => {
    setThreadsByWorkspace((prev) => ({
      ...prev,
      [spaceId]: [thread, ...(prev[spaceId] ?? [])],
    }));
  }, []);

  const handleSelectThread = useCallback((thread: Thread) => {
    for (const [wsId, wsThreads] of Object.entries(threadsByWorkspace)) {
      if (wsThreads.some((t) => t.id === thread.id)) {
        navigateToChat(wsId, thread.id);
        return;
      }
    }
    navigateToChat(selectedWorkspaceId ?? undefined, thread.id);
  }, [threadsByWorkspace, selectedWorkspaceId, navigateToChat]);

  // Sidebar action wrapper
  const runSidebarAction = useCallback((action: () => void | Promise<void>) => {
    if (isMobile) {
      setShowMobileNavDrawer(false);
    }
    void action();
  }, [isMobile]);

  // Sync threads when workspaces change
  useEffect(() => {
    if (workspaces.length === 0) {
      setThreadsByWorkspace((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    void fetchAllThreads(workspaces);
  }, [workspaces, fetchAllThreads]);

  // Close mobile drawer when switching to desktop
  useEffect(() => {
    if (!isMobile) {
      setShowMobileNavDrawer(false);
    }
  }, [isMobile]);

  // Close mobile drawer on route change
  useEffect(() => {
    if (!isMobile) return;
    setShowMobileNavDrawer(false);
  }, [isMobile, route]);

  const value = useMemo((): NavigationContextValue => ({
    route,
    navigate,
    replace,
    sidebarWorkspace,
    setSidebarWorkspace,
    handleEnterWorkspace,
    handleExitWorkspace,
    showMobileNavDrawer,
    setShowMobileNavDrawer,
    mobileNavDrawerId,
    threadsByWorkspace,
    setThreadsByWorkspace,
    allThreads,
    fetchAllThreads,
    handleNewThread,
    handleDeleteThread,
    toggleArchiveThread,
    handleNewThreadCreated,
    handleSelectThread,
    navigateToChat,
    replaceToChat,
    navigateToPreferredChat,
    preferredWorkspace,
    preferredWorkspaceId,
    routeWorkspaceId,
    selectedWorkspaceId,
    waitingForWorkspaceResolution,
    runSidebarAction,
  }), [
    route,
    navigate,
    replace,
    sidebarWorkspace,
    handleEnterWorkspace,
    handleExitWorkspace,
    showMobileNavDrawer,
    mobileNavDrawerId,
    threadsByWorkspace,
    allThreads,
    fetchAllThreads,
    handleNewThread,
    handleDeleteThread,
    toggleArchiveThread,
    handleNewThreadCreated,
    handleSelectThread,
    navigateToChat,
    replaceToChat,
    navigateToPreferredChat,
    preferredWorkspace,
    preferredWorkspaceId,
    routeWorkspaceId,
    selectedWorkspaceId,
    waitingForWorkspaceResolution,
    runSidebarAction,
  ]);

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}
