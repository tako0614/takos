import { atom, useAtomValue, useSetAtom } from 'jotai';
import { useCallback, useEffect, useMemo } from 'react';
import { getSpaceIdentifier, getPersonalSpace, findSpaceByIdentifier } from '../lib/spaces';
import { rpc, rpcJson } from '../lib/rpc';
import { useBreakpoint } from '../hooks/useBreakpoint';
import { useI18n } from './i18n';
import { useToast } from './toast';
import { useConfirmDialog } from './confirm-dialog';
import { spacesAtom, spacesLoadedAtom } from './auth';
import { useRouter } from '../hooks/useRouter';
import type { RouteState, Thread, Space } from '../types';

// ---------------------------------------------------------------------------
// Route state atoms (driven by useRouter, synced via hook)
// ---------------------------------------------------------------------------

export const routeAtom = atom<RouteState>({ view: 'home' });

/**
 * Write-only atom storing the `navigate` callback from useRouter.
 * Populated by `useNavigationSync`.
 */
export const navigateFnAtom = atom<(state: Partial<RouteState>) => void>(() => {});

/**
 * Write-only atom storing the `replace` callback from useRouter.
 * Populated by `useNavigationSync`.
 */
export const replaceFnAtom = atom<(state: RouteState) => void>(() => {});

// ---------------------------------------------------------------------------
// Sidebar atoms
// ---------------------------------------------------------------------------

export const sidebarSpaceAtom = atom<Space | null>(null);
export const showMobileNavDrawerAtom = atom<boolean>(false);
export const mobileNavDrawerId = 'mobile-navigation-drawer';

// ---------------------------------------------------------------------------
// Thread data atoms
// ---------------------------------------------------------------------------

export const threadsBySpaceAtom = atom<Record<string, Thread[]>>({});

export const allThreadsAtom = atom<Thread[]>((get) =>
  Object.values(get(threadsBySpaceAtom)).flat(),
);

// ---------------------------------------------------------------------------
// Space resolution atoms (derived)
// ---------------------------------------------------------------------------

/**
 * A helper atom that stores the translation function for 'personal'.
 * Updated via the sync hook so derived atoms can use it.
 */
export const personalLabelAtom = atom<string>('personal');

export const preferredSpaceAtom = atom<Space | undefined>((get) => {
  const spaces = get(spacesAtom);
  const label = get(personalLabelAtom);
  return getPersonalSpace(spaces, label) || spaces[0] || undefined;
});

export const preferredSpaceIdAtom = atom<string | undefined>((get) => {
  const space = get(preferredSpaceAtom);
  return space ? getSpaceIdentifier(space) : undefined;
});

export const routeSpaceIdAtom = atom<string | undefined>((get) => {
  const route = get(routeAtom);
  if (!route.spaceId) return undefined;
  const spaces = get(spacesAtom);
  const label = get(personalLabelAtom);
  const space = findSpaceByIdentifier(spaces, route.spaceId, label);
  return space ? getSpaceIdentifier(space) : undefined;
});

export const selectedSpaceIdAtom = atom<string | null>((get) => {
  const route = get(routeAtom);
  const routeSpaceId = get(routeSpaceIdAtom);
  const preferredSpaceId = get(preferredSpaceIdAtom);
  return route.spaceId
    ? routeSpaceId ?? null
    : preferredSpaceId ?? null;
});

export const waitingForSpaceResolutionAtom = atom<boolean>((get) => {
  const route = get(routeAtom);
  const routeSpaceId = get(routeSpaceIdAtom);
  const spacesLoaded = get(spacesLoadedAtom);
  return Boolean(route.spaceId) && !routeSpaceId && !spacesLoaded;
});

// ---------------------------------------------------------------------------
// Fetch threads action atom
// ---------------------------------------------------------------------------

export const fetchAllThreadsAtom = atom(
  null,
  async (get, set, wsList?: Space[]) => {
    const list = wsList ?? get(spacesAtom);
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
    set(threadsBySpaceAtom, Object.fromEntries(entries));
  },
);

// ---------------------------------------------------------------------------
// Compatibility hook: useNavigation()
// ---------------------------------------------------------------------------

/**
 * Syncs useRouter and useBreakpoint state into atoms, and sets up effects.
 * Must be called once near the root of the tree (replaces NavigationProvider).
 */
export function useNavigationSync() {
  const { route, navigate, replace } = useRouter();
  const { isMobile } = useBreakpoint();
  const { t } = useI18n();
  const spaces = useAtomValue(spacesAtom);
  const setRoute = useSetAtom(routeAtom);
  const setNavigateFn = useSetAtom(navigateFnAtom);
  const setReplaceFn = useSetAtom(replaceFnAtom);
  const setPersonalLabel = useSetAtom(personalLabelAtom);
  const setShowMobileNavDrawer = useSetAtom(showMobileNavDrawerAtom);
  const dispatchFetchAllThreads = useSetAtom(fetchAllThreadsAtom);
  const setThreadsBySpace = useSetAtom(threadsBySpaceAtom);

  // Sync route into atom
  useEffect(() => {
    setRoute(route);
  }, [route, setRoute]);

  // Sync router functions into atoms
  useEffect(() => {
    setNavigateFn(() => navigate);
  }, [navigate, setNavigateFn]);

  useEffect(() => {
    setReplaceFn(() => replace);
  }, [replace, setReplaceFn]);

  // Sync translation label
  useEffect(() => {
    setPersonalLabel(t('personal'));
  }, [t, setPersonalLabel]);

  // Sync threads when spaces change
  useEffect(() => {
    if (spaces.length === 0) {
      setThreadsBySpace((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    void dispatchFetchAllThreads(spaces);
  }, [spaces, dispatchFetchAllThreads, setThreadsBySpace]);

  // Close mobile drawer when switching to desktop
  useEffect(() => {
    if (!isMobile) {
      setShowMobileNavDrawer(false);
    }
  }, [isMobile, setShowMobileNavDrawer]);

  // Close mobile drawer on route change
  useEffect(() => {
    if (!isMobile) return;
    setShowMobileNavDrawer(false);
  }, [isMobile, route, setShowMobileNavDrawer]);
}

/**
 * Drop-in replacement for the old useNavigation() context hook.
 * Returns the same interface so consumers don't need to change their usage.
 */
export function useNavigation() {
  const { t } = useI18n();
  const { isMobile } = useBreakpoint();
  const { showToast } = useToast();
  const { confirm } = useConfirmDialog();

  const route = useAtomValue(routeAtom);
  const navigate = useAtomValue(navigateFnAtom);
  const replace = useAtomValue(replaceFnAtom);

  const sidebarSpace = useAtomValue(sidebarSpaceAtom);
  const setSidebarSpace = useSetAtom(sidebarSpaceAtom);

  const showMobileNavDrawer = useAtomValue(showMobileNavDrawerAtom);
  const setShowMobileNavDrawer = useSetAtom(showMobileNavDrawerAtom);

  const threadsBySpace = useAtomValue(threadsBySpaceAtom);
  const setThreadsBySpace = useSetAtom(threadsBySpaceAtom);
  const allThreads = useAtomValue(allThreadsAtom);

  const preferredSpace = useAtomValue(preferredSpaceAtom);
  const preferredSpaceId = useAtomValue(preferredSpaceIdAtom);
  const routeSpaceId = useAtomValue(routeSpaceIdAtom);
  const selectedSpaceId = useAtomValue(selectedSpaceIdAtom);
  const waitingForSpaceResolution = useAtomValue(waitingForSpaceResolutionAtom);

  const dispatchFetchAllThreads = useSetAtom(fetchAllThreadsAtom);

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
  }, [navigate, setSidebarSpace]);

  const handleExitSpace = useCallback(() => {
    setSidebarSpace(null);
    replace({ view: 'apps', spaceId: preferredSpaceId });
  }, [replace, preferredSpaceId, setSidebarSpace]);

  // Thread fetching
  const fetchAllThreads = useCallback(async (wsList?: Space[]) => {
    await dispatchFetchAllThreads(wsList);
  }, [dispatchFetchAllThreads]);

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
  }, [confirm, t, showToast, route.threadId, selectedSpaceId, navigateToChat, setThreadsBySpace]);

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
  }, [setThreadsBySpace]);

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
  }, [isMobile, setShowMobileNavDrawer]);

  return useMemo(() => ({
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
    setSidebarSpace,
    handleEnterSpace,
    handleExitSpace,
    showMobileNavDrawer,
    setShowMobileNavDrawer,
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
  ]);
}
