import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getSpaceIdentifier, getPersonalSpace, findSpaceByIdentifier } from '../lib/spaces';
import { rpc, rpcJson } from '../lib/rpc';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useI18n } from '../providers/I18nProvider';
import { useToast } from '../hooks/useToast';
import { useConfirmDialog } from '../providers/ConfirmDialogProvider';
import type { RouteState, Thread, Space } from '../types';

interface NavigationContextValue {
  // Router (single source of truth)
  route: RouteState;
  navigate: (state: Partial<RouteState>) => void;
  replace: (state: RouteState) => void;

  // Sidebar space mode
  sidebarSpace: Space | null;
  setSidebarSpace: (ws: Space | null) => void;
  handleEnterSpace: (ws: Space) => void;
  handleExitSpace: () => void;

  // Mobile drawer
  showMobileNavDrawer: boolean;
  setShowMobileNavDrawer: (show: boolean) => void;
  mobileNavDrawerId: string;

  // Thread state
  threadsBySpace: Record<string, Thread[]>;
  setThreadsBySpace: React.Dispatch<React.SetStateAction<Record<string, Thread[]>>>;
  allThreads: Thread[];
  fetchAllThreads: (wsList?: Space[]) => Promise<void>;
  handleNewThread: () => void;
  handleDeleteThread: (threadId: string) => Promise<void>;
  toggleArchiveThread: (thread: Thread) => Promise<void>;
  handleNewThreadCreated: (spaceId: string, thread: Thread) => void;
  handleSelectThread: (thread: Thread) => void;

  // Navigation helpers
  navigateToChat: (spaceId?: string, threadId?: string) => void;
  replaceToChat: (spaceId?: string) => void;
  navigateToPreferredChat: () => void;

  // Space resolution
  preferredSpace: Space | undefined;
  preferredSpaceId: string | undefined;
  routeSpaceId: string | undefined;
  selectedSpaceId: string | null;
  waitingForSpaceResolution: boolean;

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
  spaces: Space[];
  spacesLoaded: boolean;
  route: RouteState;
  navigate: (state: Partial<RouteState>) => void;
  replace: (state: RouteState) => void;
}

export function NavigationProvider({ children, spaces, spacesLoaded, route, navigate, replace }: NavigationProviderProps) {
  const { t } = useI18n();
  const { isMobile } = useBreakpoint();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();

  const [sidebarSpace, setSidebarSpace] = useState<Space | null>(null);
  const [showMobileNavDrawer, setShowMobileNavDrawer] = useState(false);
  const mobileNavDrawerId = 'mobile-navigation-drawer';

  // Thread state keyed by space identifier
  const [threadsBySpace, setThreadsBySpace] = useState<Record<string, Thread[]>>({});
  const allThreads = useMemo(
    () => Object.values(threadsBySpace).flat(),
    [threadsBySpace],
  );

  // Space resolution
  const preferredSpace = useMemo(
    () => getPersonalSpace(spaces, t('personal')) || spaces[0],
    [spaces, t],
  );

  const preferredSpaceId = useMemo(
    () => (preferredSpace ? getSpaceIdentifier(preferredSpace) : undefined),
    [preferredSpace],
  );

  const routeSpaceId = useMemo(() => {
    if (!route.spaceId) return undefined;
    const space = findSpaceByIdentifier(spaces, route.spaceId, t('personal'));
    return space ? getSpaceIdentifier(space) : undefined;
  }, [route.spaceId, spaces, t]);

  const selectedSpaceId = route.spaceId
    ? routeSpaceId ?? null
    : preferredSpaceId ?? null;
  const waitingForSpaceResolution = Boolean(route.spaceId) && !routeSpaceId && !spacesLoaded;

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
    navigateToChat(preferredSpaceId);
  }, [navigateToChat, preferredSpaceId]);

  // Sidebar space handlers
  const handleEnterSpace = useCallback((ws: Space) => {
    setSidebarSpace(ws);
    navigate({ view: 'chat', spaceId: getSpaceIdentifier(ws), threadId: undefined, runId: undefined, messageId: undefined });
  }, [navigate]);

  const handleExitSpace = useCallback(() => {
    setSidebarSpace(null);
    replace({ view: 'apps', spaceId: preferredSpaceId });
  }, [replace, preferredSpaceId]);

  // Thread fetching
  const fetchAllThreads = useCallback(async (wsList?: Space[]) => {
    const list = wsList ?? spaces;
    if (list.length === 0) return;
    const entries = await Promise.all(
      list.map(async (ws) => {
        const identifier = getSpaceIdentifier(ws);
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
    setThreadsBySpace(Object.fromEntries(entries));
  }, [spaces]);

  // Thread CRUD
  const handleNewThread = useCallback(() => {
    if (!preferredSpaceId) return;
    navigateToChat(preferredSpaceId);
  }, [preferredSpaceId, navigateToChat]);

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
      setThreadsBySpace((prev) => {
        const next: Record<string, Thread[]> = {};
        for (const key of Object.keys(prev)) {
          next[key] = prev[key].filter((th) => th.id !== threadId);
        }
        return next;
      });
      if (route.threadId === threadId) {
        navigateToChat(selectedSpaceId ?? undefined);
      }
      showToast('success', t('deleted'));
    } catch {
      showToast('error', t('failedToDelete'));
    }
  }, [confirm, t, showToast, route.threadId, selectedSpaceId, navigateToChat]);

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
    setThreadsBySpace((prev) => ({
      ...prev,
      [spaceId]: [thread, ...(prev[spaceId] ?? [])],
    }));
  }, []);

  const handleSelectThread = useCallback((thread: Thread) => {
    for (const [spId, spThreads] of Object.entries(threadsBySpace)) {
      if (spThreads.some((t) => t.id === thread.id)) {
        navigateToChat(spId, thread.id);
        return;
      }
    }
    navigateToChat(selectedSpaceId ?? undefined, thread.id);
  }, [threadsBySpace, selectedSpaceId, navigateToChat]);

  // Sidebar action wrapper
  const runSidebarAction = useCallback((action: () => void | Promise<void>) => {
    if (isMobile) {
      setShowMobileNavDrawer(false);
    }
    void action();
  }, [isMobile]);

  // Sync threads when spaces change
  useEffect(() => {
    if (spaces.length === 0) {
      setThreadsBySpace((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    void fetchAllThreads(spaces);
  }, [spaces, fetchAllThreads]);

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
    sidebarSpace,
    setSidebarSpace,
    handleEnterSpace,
    handleExitSpace,
    showMobileNavDrawer,
    setShowMobileNavDrawer,
    mobileNavDrawerId,
    threadsBySpace,
    setThreadsBySpace,
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
    preferredSpace,
    preferredSpaceId,
    routeSpaceId,
    selectedSpaceId,
    waitingForSpaceResolution,
    runSidebarAction,
  }), [
    route,
    navigate,
    replace,
    sidebarSpace,
    handleEnterSpace,
    handleExitSpace,
    showMobileNavDrawer,
    mobileNavDrawerId,
    threadsBySpace,
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
    preferredSpace,
    preferredSpaceId,
    routeSpaceId,
    selectedSpaceId,
    waitingForSpaceResolution,
    runSidebarAction,
  ]);

  return (
    <NavigationContext.Provider value={value}>
      {children}
    </NavigationContext.Provider>
  );
}
