import {
  createContext,
  createEffect,
  createMemo,
  createResource,
  createSignal,
  type ParentComponent,
  type Setter,
  useContext,
} from "solid-js";
import { useBreakpoint } from "../hooks/useBreakpoint.ts";
import { useRouter } from "../hooks/useRouter.ts";
import { useAuth } from "../hooks/useAuth.tsx";
import { useI18n } from "./i18n.ts";
import { useToast } from "./toast.ts";
import { useConfirmDialog } from "./confirm-dialog.ts";
import {
  findSpaceByIdentifier,
  getPersonalSpace,
  getSpaceIdentifier,
} from "../lib/spaces.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";
import type { RouteState, Space, Thread } from "../types/index.ts";
import {
  parseChatThreadActionResponse,
  parseChatThreadInventoryResponse,
} from "../hooks/chat-thread-response.ts";
import {
  applyThreadLifecycleToInventory,
  mapWithConcurrency,
  selectThreadInventorySpaces,
  THREAD_INVENTORY_CONCURRENCY,
  type ThreadNavigationState,
} from "../lib/thread-navigation.ts";

export const mobileNavDrawerId = "mobile-navigation-drawer";

interface NavigationContextValue {
  route: RouteState;
  navigate: (newState: Partial<RouteState>) => void;
  replace: (newState: RouteState) => void;
  sidebarSpace: Space | null;
  setSidebarSpace: Setter<Space | null>;
  handleEnterSpace: (space: Space) => void;
  handleExitSpace: () => void;
  showMobileNavDrawer: boolean;
  setShowMobileNavDrawer: Setter<boolean>;
  mobileNavDrawerId: string;
  threadsBySpace: Record<string, Thread[]>;
  threadInventoryTruncatedBySpace: Record<string, boolean>;
  threadInventoryFailedBySpace: Record<string, boolean>;
  threadInventoryLoading: boolean;
  setThreadsBySpace: Setter<Record<string, Thread[]>>;
  allThreads: Thread[];
  retryThreadInventory: () => Promise<void>;
  handleNewThread: () => void;
  handleDeleteThread: (threadId: string) => Promise<void>;
  toggleArchiveThread: (thread: Thread) => Promise<boolean>;
  isThreadActionPending: (threadId: string) => boolean;
  handleNewThreadCreated: (spaceId: string, thread: Thread) => void;
  handleSelectThread: (thread: Thread) => void;
  navigateToChat: (spaceId?: string, threadId?: string) => void;
  replaceToChat: (spaceId?: string) => void;
  navigateToPreferredChat: () => void;
  preferredSpace: Space | undefined;
  preferredSpaceId: string | undefined;
  routeSpaceId: string | undefined;
  selectedSpaceId: string | null;
  waitingForSpaceResolution: boolean;
  runSidebarAction: (action: () => void | Promise<void>) => void;
}

const NavigationContext = createContext<NavigationContextValue>();

async function fetchThreadsBySpace(
  spaces: Space[],
): Promise<ThreadNavigationState> {
  if (spaces.length === 0) {
    return {
      threadsBySpace: {},
      truncatedBySpace: {},
      failedBySpace: {},
    };
  }

  const entries = await mapWithConcurrency(
    spaces,
    THREAD_INVENTORY_CONCURRENCY,
    async (space) => {
      const identifier = getSpaceIdentifier(space);
      try {
        const response = await rpc.spaces[":spaceId"].threads.$get({
          param: { spaceId: identifier },
          query: { status: "active" },
        });
        const page = parseChatThreadInventoryResponse(
          await rpcJson<unknown>(response),
          space.id,
        );
        return [identifier, page, false] as const;
      } catch {
        return [
          identifier,
          { threads: [] as Thread[], truncated: false },
          true,
        ] as const;
      }
    },
  );

  return {
    threadsBySpace: Object.fromEntries(
      entries.map(([identifier, page]) => [identifier, page.threads]),
    ),
    truncatedBySpace: Object.fromEntries(
      entries.map(([identifier, page]) => [identifier, page.truncated]),
    ),
    failedBySpace: Object.fromEntries(
      entries.map(([identifier, , failed]) => [identifier, failed]),
    ),
  };
}

export const NavigationProvider: ParentComponent = (props) => {
  const auth = useAuth();
  const router = useRouter();
  const { t } = useI18n();
  const breakpoint = useBreakpoint();
  const toast = useToast();
  const { confirm } = useConfirmDialog();

  const [sidebarSpaceSignal, setSidebarSpaceSignal] = createSignal<
    Space | null
  >(null);
  const [showMobileNavDrawerSignal, setShowMobileNavDrawerSignal] =
    createSignal(false);
  const [pendingThreadActionIds, setPendingThreadActionIds] = createSignal<
    ReadonlySet<string>
  >(new Set());

  const beginThreadAction = (threadId: string): boolean => {
    if (pendingThreadActionIds().has(threadId)) return false;
    setPendingThreadActionIds((current) => {
      const next = new Set(current);
      next.add(threadId);
      return next;
    });
    return true;
  };

  const endThreadAction = (threadId: string) => {
    setPendingThreadActionIds((current) => {
      const next = new Set(current);
      next.delete(threadId);
      return next;
    });
  };

  const personalLabel = createMemo(() => t("personal"));
  const preferredSpace = createMemo(() =>
    getPersonalSpace(auth.spaces, personalLabel()) || auth.spaces[0] ||
    undefined
  );
  const preferredSpaceId = createMemo(() => {
    const space = preferredSpace();
    return space ? getSpaceIdentifier(space) : undefined;
  });
  const routeSpace = createMemo(() => {
    const route = router.route;
    if (!route.spaceId) return undefined;
    return findSpaceByIdentifier(
      auth.spaces,
      route.spaceId,
      personalLabel(),
    );
  });
  const routeSpaceId = createMemo(() => {
    const space = routeSpace();
    return space ? getSpaceIdentifier(space) : undefined;
  });
  const targetThreadSpaces = createMemo(() => {
    if (auth.authState !== "authenticated") return [] as Space[];
    return selectThreadInventorySpaces(
      preferredSpace(),
      routeSpace() ?? undefined,
      sidebarSpaceSignal() ?? undefined,
    );
  });
  const [threadsBySpaceSignal, threadControls] = createResource(
    targetThreadSpaces,
    fetchThreadsBySpace,
    {
      initialValue: {
        threadsBySpace: {},
        truncatedBySpace: {},
        failedBySpace: {},
      } as ThreadNavigationState,
    },
  );

  createEffect(() => {
    if (!breakpoint.isMobile) {
      setShowMobileNavDrawerSignal(false);
    }
  });

  createEffect(() => {
    if (!breakpoint.isMobile) return;
    void router.route;
    setShowMobileNavDrawerSignal(false);
  });

  const selectedSpaceId = createMemo(() => {
    const route = router.route;
    return route.spaceId ? routeSpaceId() ?? null : preferredSpaceId() ?? null;
  });
  const waitingForSpaceResolution = createMemo(() => {
    const route = router.route;
    return Boolean(route.spaceId) && !routeSpaceId() && !auth.spacesLoaded;
  });
  const allThreads = createMemo(() =>
    Object.values(threadsBySpaceSignal().threadsBySpace).flat()
  );

  const mutateSidebarSpace: Setter<Space | null> = (next) => {
    const current = sidebarSpaceSignal() ?? null;
    const value = typeof next === "function" ? next(current) : next;
    setSidebarSpaceSignal(() => value);
    return value;
  };

  const mutateShowMobileNavDrawer: Setter<boolean> = (next) => {
    const current = showMobileNavDrawerSignal() ?? false;
    const value = typeof next === "function" ? next(current) : next;
    setShowMobileNavDrawerSignal(() => value);
    return value;
  };

  const setThreadsBySpace: Setter<Record<string, Thread[]>> = (next) => {
    const state = threadsBySpaceSignal();
    const current = state.threadsBySpace;
    const value = typeof next === "function" ? next(current) : next;
    threadControls.mutate(() => ({ ...state, threadsBySpace: value }));
    return value;
  };

  const retryThreadInventory = async () => {
    await threadControls.refetch();
  };

  const navigateToChat = (spaceId?: string, threadId?: string) => {
    if (spaceId && threadId) {
      router.navigate({
        view: "chat",
        spaceId,
        threadId,
        runId: undefined,
        messageId: undefined,
      });
      return;
    }
    if (spaceId) {
      router.navigate({
        view: "chat",
        spaceId,
        threadId: undefined,
        runId: undefined,
        messageId: undefined,
      });
      return;
    }
    router.navigate({
      view: "chat",
      threadId: undefined,
      runId: undefined,
      messageId: undefined,
    });
  };

  const replaceToChat = (spaceId?: string) => {
    if (spaceId) {
      router.replace({
        view: "chat",
        spaceId,
        runId: undefined,
        messageId: undefined,
      });
      return;
    }
    router.replace({ view: "chat", runId: undefined, messageId: undefined });
  };

  const navigateToPreferredChat = () => {
    navigateToChat(preferredSpaceId());
  };

  const handleEnterSpace = (space: Space) => {
    mutateSidebarSpace(space);
    router.navigate({
      view: "chat",
      spaceId: getSpaceIdentifier(space),
      threadId: undefined,
      runId: undefined,
      messageId: undefined,
    });
  };

  const handleExitSpace = () => {
    mutateSidebarSpace(null);
    router.replace({
      view: "chat",
      spaceId: preferredSpaceId(),
      runId: undefined,
      messageId: undefined,
    });
  };

  const handleNewThread = () => {
    const spaceId = preferredSpaceId();
    if (!spaceId) return;
    navigateToChat(spaceId);
  };

  const handleDeleteThread = async (threadId: string) => {
    if (!beginThreadAction(threadId)) return;

    try {
      const confirmed = await confirm({
        title: t("confirmDelete"),
        message: t("confirmDeleteThread"),
        confirmText: t("delete"),
        danger: true,
      });
      if (!confirmed) return;

      const response = await rpc.threads[":id"].$delete({
        param: { id: threadId },
      });
      parseChatThreadActionResponse(await rpcJson<unknown>(response), {
        threadId,
        status: "deleted",
      });
      const deletedThread = allThreads().find((thread) =>
        thread.id === threadId
      );
      if (deletedThread) {
        threadControls.mutate((current) =>
          applyThreadLifecycleToInventory(
            current,
            deletedThread,
            "deleted",
          )
        );
      }
      if (router.route.threadId === threadId) {
        navigateToChat(selectedSpaceId() ?? undefined);
      }
      toast.showToast("success", t("deleted"));
    } catch {
      toast.showToast("error", t("failedToDelete"));
    } finally {
      endThreadAction(threadId);
    }
  };

  const toggleArchiveThread = async (thread: Thread): Promise<boolean> => {
    if (!beginThreadAction(thread.id)) return false;
    try {
      const archive = thread.status !== "archived";
      const expectedStatus = archive ? "archived" : "active";
      const response = await (archive
        ? rpc.threads[":id"].archive.$post({ param: { id: thread.id } })
        : rpc.threads[":id"].unarchive.$post({ param: { id: thread.id } }));
      parseChatThreadActionResponse(await rpcJson<unknown>(response), {
        threadId: thread.id,
        status: expectedStatus,
      });
      const space = auth.spaces.find((candidate) =>
        candidate.id === thread.space_id
      );
      threadControls.mutate((current) =>
        applyThreadLifecycleToInventory(
          current,
          thread,
          expectedStatus,
          space ? getSpaceIdentifier(space) : undefined,
        )
      );
      if (archive && router.route.threadId === thread.id) {
        navigateToChat(selectedSpaceId() ?? undefined);
      }
      toast.showToast(
        "success",
        archive ? t("archiveThread") : t("unarchiveThread"),
      );
      return true;
    } catch (error) {
      toast.showToast(
        "error",
        error instanceof Error ? error.message : t("failedToSave"),
      );
      return false;
    } finally {
      endThreadAction(thread.id);
    }
  };

  const handleNewThreadCreated = (spaceId: string, thread: Thread) => {
    threadControls.mutate((current) =>
      applyThreadLifecycleToInventory(current, thread, "active", spaceId)
    );
  };

  const handleSelectThread = (thread: Thread) => {
    const threadMap = threadsBySpaceSignal().threadsBySpace;
    for (const [spaceId, threads] of Object.entries(threadMap)) {
      if (threads.some((candidate) => candidate.id === thread.id)) {
        navigateToChat(spaceId, thread.id);
        return;
      }
    }
    navigateToChat(selectedSpaceId() ?? undefined, thread.id);
  };

  const runSidebarAction = (action: () => void | Promise<void>) => {
    if (breakpoint.isMobile) {
      mutateShowMobileNavDrawer(false);
    }
    void action();
  };

  const value: NavigationContextValue = {
    get route() {
      return router.route;
    },
    get navigate() {
      return router.navigate;
    },
    get replace() {
      return router.replace;
    },
    get sidebarSpace() {
      return sidebarSpaceSignal() ?? null;
    },
    setSidebarSpace: mutateSidebarSpace,
    handleEnterSpace,
    handleExitSpace,
    get showMobileNavDrawer() {
      return showMobileNavDrawerSignal() ?? false;
    },
    setShowMobileNavDrawer: mutateShowMobileNavDrawer,
    mobileNavDrawerId,
    get threadsBySpace() {
      return threadsBySpaceSignal().threadsBySpace;
    },
    get threadInventoryTruncatedBySpace() {
      return threadsBySpaceSignal().truncatedBySpace;
    },
    get threadInventoryFailedBySpace() {
      return threadsBySpaceSignal().failedBySpace;
    },
    get threadInventoryLoading() {
      return threadsBySpaceSignal.loading;
    },
    setThreadsBySpace,
    get allThreads() {
      return allThreads();
    },
    retryThreadInventory,
    handleNewThread,
    handleDeleteThread,
    toggleArchiveThread,
    isThreadActionPending: (threadId) =>
      pendingThreadActionIds().has(threadId),
    handleNewThreadCreated,
    handleSelectThread,
    navigateToChat,
    replaceToChat,
    navigateToPreferredChat,
    get preferredSpace() {
      return preferredSpace();
    },
    get preferredSpaceId() {
      return preferredSpaceId();
    },
    get routeSpaceId() {
      return routeSpaceId();
    },
    get selectedSpaceId() {
      return selectedSpaceId();
    },
    get waitingForSpaceResolution() {
      return waitingForSpaceResolution();
    },
    runSidebarAction,
  };

  return (
    <NavigationContext.Provider value={value}>
      {props.children}
    </NavigationContext.Provider>
  );
};

export function useNavigation(): NavigationContextValue {
  const context = useContext(NavigationContext);
  if (!context) {
    throw new Error("useNavigation must be used within a NavigationProvider");
  }
  return context;
}
