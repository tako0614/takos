import { useAtomValue, useSetAtom } from 'solid-jotai';
import { createEffect } from 'solid-js';
import { getSpaceIdentifier } from '../lib/spaces.ts';
import { rpc, rpcJson } from '../lib/rpc.ts';
import { useBreakpoint } from '../hooks/useBreakpoint.ts';
import { useI18n } from './i18n.ts';
import { useToast } from './toast.ts';
import { useConfirmDialog } from './confirm-dialog.ts';
import { spacesAtom } from './auth.ts';
import { useRouter } from '../hooks/useRouter.ts';
import type { Thread, Space } from '../types/index.ts';
import {
  routeAtom,
  navigateFnAtom,
  replaceFnAtom,
  sidebarSpaceAtom,
  showMobileNavDrawerAtom,
  mobileNavDrawerId,
  threadsBySpaceAtom,
  allThreadsAtom,
  personalLabelAtom,
  preferredSpaceAtom,
  preferredSpaceIdAtom,
  routeSpaceIdAtom,
  selectedSpaceIdAtom,
  waitingForSpaceResolutionAtom,
  fetchAllThreadsAtom,
} from './navigation-atoms.ts';

// ---------------------------------------------------------------------------
// Compatibility hook: useNavigation()
// ---------------------------------------------------------------------------

/**
 * Syncs useRouter and useBreakpoint state into atoms, and sets up effects.
 * Must be called once near the root of the tree (replaces NavigationProvider).
 */
export function useNavigationSync() {
  const router = useRouter();
  const { isMobile } = useBreakpoint();
  const i18n = useI18n();
  const spaces = useAtomValue(spacesAtom);
  const setRoute = useSetAtom(routeAtom);
  const setNavigateFn = useSetAtom(navigateFnAtom);
  const setReplaceFn = useSetAtom(replaceFnAtom);
  const setPersonalLabel = useSetAtom(personalLabelAtom);
  const setShowMobileNavDrawer = useSetAtom(showMobileNavDrawerAtom);
  const dispatchFetchAllThreads = useSetAtom(fetchAllThreadsAtom);
  const setThreadsBySpace = useSetAtom(threadsBySpaceAtom);

  // Sync route into atom
  createEffect(() => {
    setRoute(router.route);
  });

  // Sync router functions into atoms
  createEffect(() => {
    setNavigateFn(() => router.navigate);
  });

  createEffect(() => {
    setReplaceFn(() => router.replace);
  });

  // Sync translation label
  createEffect(() => {
    setPersonalLabel(i18n.t('personal'));
  });

  // Sync threads when spaces change
  createEffect(() => {
    const currentSpaces = spaces();
    if (currentSpaces.length === 0) {
      setThreadsBySpace((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return;
    }
    void dispatchFetchAllThreads(currentSpaces);
  });

  // Close mobile drawer when switching to desktop
  createEffect(() => {
    if (!isMobile) {
      setShowMobileNavDrawer(false);
    }
  });

  // Close mobile drawer on route change
  createEffect(() => {
    if (!isMobile) return;
    // Access route to track it reactively
    void router.route;
    setShowMobileNavDrawer(false);
  });
}

/**
 * Drop-in replacement for the old useNavigation() context hook.
 * Returns the same interface so consumers don't need to change their usage.
 */
export function useNavigation() {
  const i18n = useI18n();
  const { isMobile } = useBreakpoint();
  const toast = useToast();
  const { confirm } = useConfirmDialog();

  const route = useAtomValue(routeAtom);
  const navigateFn = useAtomValue(navigateFnAtom);
  const replaceFn = useAtomValue(replaceFnAtom);

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
  const navigateToChat = (spaceId?: string, threadId?: string) => {
    if (spaceId && threadId) {
      navigateFn()({ view: 'chat', spaceId, threadId, runId: undefined, messageId: undefined });
      return;
    }
    if (spaceId) {
      navigateFn()({ view: 'chat', spaceId, threadId: undefined, runId: undefined, messageId: undefined });
      return;
    }
    navigateFn()({ view: 'chat', threadId: undefined, runId: undefined, messageId: undefined });
  };

  const replaceToChat = (spaceId?: string) => {
    if (spaceId) {
      replaceFn()({ view: 'chat', spaceId, runId: undefined, messageId: undefined });
      return;
    }
    replaceFn()({ view: 'chat', runId: undefined, messageId: undefined });
  };

  const navigateToPreferredChat = () => {
    navigateToChat(preferredSpaceId());
  };

  // Sidebar space handlers
  const handleEnterSpace = (ws: Space) => {
    setSidebarSpace(ws);
    navigateFn()({ view: 'chat', spaceId: getSpaceIdentifier(ws), threadId: undefined, runId: undefined, messageId: undefined });
  };

  const handleExitSpace = () => {
    setSidebarSpace(null);
    replaceFn()({ view: 'apps', spaceId: preferredSpaceId() });
  };

  // Thread fetching
  const fetchAllThreads = async (wsList?: Space[]) => {
    await dispatchFetchAllThreads(wsList);
  };

  // Thread CRUD
  const handleNewThread = () => {
    if (!preferredSpaceId()) return;
    navigateToChat(preferredSpaceId());
  };

  const handleDeleteThread = async (threadId: string) => {
    const confirmed = await confirm({
      title: i18n.t('confirmDelete'),
      message: i18n.t('confirmDeleteThread'),
      confirmText: i18n.t('delete'),
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
      if (route().threadId === threadId) {
        navigateToChat(selectedSpaceId() ?? undefined);
      }
      toast.showToast('success', i18n.t('deleted'));
    } catch {
      toast.showToast('error', i18n.t('failedToDelete'));
    }
  };

  const toggleArchiveThread = async (thread: Thread) => {
    try {
      const endpoint = thread.status === 'archived' ? 'unarchive' : 'archive';
      const res = await (endpoint === 'archive'
        ? rpc.threads[':id'].archive.$post({ param: { id: thread.id } })
        : rpc.threads[':id'].unarchive.$post({ param: { id: thread.id } })
      );
      await rpcJson(res);
      await fetchAllThreads();
      toast.showToast('success', endpoint === 'archive' ? (i18n.t('routingStatus_archived') || 'Archived') : (i18n.t('routingStatus_active') || 'Active'));
    } catch (err) {
      toast.showToast('error', err instanceof Error ? err.message : i18n.t('failedToSave'));
    }
  };

  const handleNewThreadCreated = (spaceId: string, thread: Thread) => {
    setThreadsBySpace((prev) => ({
      ...prev,
      [spaceId]: [thread, ...(prev[spaceId] ?? [])],
    }));
  };

  const handleSelectThread = (thread: Thread) => {
    for (const [spId, spThreads] of Object.entries(threadsBySpace())) {
      if (spThreads.some((t) => t.id === thread.id)) {
        navigateToChat(spId, thread.id);
        return;
      }
    }
    navigateToChat(selectedSpaceId() ?? undefined, thread.id);
  };

  // Sidebar action wrapper
  const runSidebarAction = (action: () => void | Promise<void>) => {
    if (isMobile) {
      setShowMobileNavDrawer(false);
    }
    void action();
  };

  return {
    get route() { return route(); },
    get navigate() { return navigateFn(); },
    get replace() { return replaceFn(); },
    get sidebarSpace() { return sidebarSpace(); },
    setSidebarSpace,
    handleEnterSpace,
    handleExitSpace,
    get showMobileNavDrawer() { return showMobileNavDrawer(); },
    setShowMobileNavDrawer,
    mobileNavDrawerId,
    get threadsBySpace() { return threadsBySpace(); },
    setThreadsBySpace,
    get allThreads() { return allThreads(); },
    fetchAllThreads,
    handleNewThread,
    handleDeleteThread,
    toggleArchiveThread,
    handleNewThreadCreated,
    handleSelectThread,
    navigateToChat,
    replaceToChat,
    navigateToPreferredChat,
    get preferredSpace() { return preferredSpace(); },
    get preferredSpaceId() { return preferredSpaceId(); },
    get routeSpaceId() { return routeSpaceId(); },
    get selectedSpaceId() { return selectedSpaceId(); },
    get waitingForSpaceResolution() { return waitingForSpaceResolution(); },
    runSidebarAction,
  };
}
