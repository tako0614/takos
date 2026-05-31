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
  setThreadsBySpace: Setter<Record<string, Thread[]>>;
  allThreads: Thread[];
  fetchAllThreads: (spaces?: Space[]) => Promise<void>;
  handleNewThread: () => void;
  handleDeleteThread: (threadId: string) => Promise<void>;
  toggleArchiveThread: (thread: Thread) => Promise<void>;
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
): Promise<Record<string, Thread[]>> {
  if (spaces.length === 0) {
    return {};
  }

  const entries = await Promise.all(
    spaces.map(async (space) => {
      const identifier = getSpaceIdentifier(space);
      try {
        const response = await rpc.spaces[":spaceId"].threads.$get({
          param: { spaceId: identifier },
          query: { status: "active" },
        });
        const data = await rpcJson<{ threads: Thread[] }>(response);
        return [identifier, data.threads] as const;
      } catch {
        return [identifier, [] as Thread[]] as const;
      }
    }),
  );

  return Object.fromEntries(entries);
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

  const threadSource = createMemo(() =>
    auth.authState === "authenticated"
      ? auth.spaces.map((space) => getSpaceIdentifier(space)).join("|")
      : ""
  );
  const [threadsBySpaceSignal, threadControls] = createResource(
    threadSource,
    async (key) => {
      if (!key) {
        return {};
      }
      return await fetchThreadsBySpace(auth.spaces);
    },
    { initialValue: {} as Record<string, Thread[]> },
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

  const personalLabel = createMemo(() => t("personal"));
  const preferredSpace = createMemo(() =>
    getPersonalSpace(auth.spaces, personalLabel()) || auth.spaces[0] ||
    undefined
  );
  const preferredSpaceId = createMemo(() => {
    const space = preferredSpace();
    return space ? getSpaceIdentifier(space) : undefined;
  });
  const routeSpaceId = createMemo(() => {
    const route = router.route;
    if (!route.spaceId) return undefined;
    const space = findSpaceByIdentifier(
      auth.spaces,
      route.spaceId,
      personalLabel(),
    );
    return space ? getSpaceIdentifier(space) : undefined;
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
    Object.values(threadsBySpaceSignal() ?? {}).flat()
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
    const current = threadsBySpaceSignal() ?? {};
    const value = typeof next === "function" ? next(current) : next;
    threadControls.mutate(() => value);
    return value;
  };

  const fetchAllThreads = async (spaces?: Space[]) => {
    const next = await fetchThreadsBySpace(spaces ?? auth.spaces);
    threadControls.mutate(() => next);
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
    router.replace({ view: "apps", spaceId: preferredSpaceId() });
  };

  const handleNewThread = () => {
    const spaceId = preferredSpaceId();
    if (!spaceId) return;
    navigateToChat(spaceId);
  };

  const handleDeleteThread = async (threadId: string) => {
    const confirmed = await confirm({
      title: t("confirmDelete"),
      message: t("confirmDeleteThread"),
      confirmText: t("delete"),
      danger: true,
    });
    if (!confirmed) return;

    try {
      const response = await rpc.threads[":id"].$delete({
        param: { id: threadId },
      });
      await rpcJson(response);
      setThreadsBySpace((previous) => {
        const next: Record<string, Thread[]> = {};
        for (const key of Object.keys(previous)) {
          next[key] = previous[key].filter((thread) => thread.id !== threadId);
        }
        return next;
      });
      if (router.route.threadId === threadId) {
        navigateToChat(selectedSpaceId() ?? undefined);
      }
      toast.showToast("success", t("deleted"));
    } catch {
      toast.showToast("error", t("failedToDelete"));
    }
  };

  const toggleArchiveThread = async (thread: Thread) => {
    try {
      const archive = thread.status !== "archived";
      const response = await (archive
        ? rpc.threads[":id"].archive.$post({ param: { id: thread.id } })
        : rpc.threads[":id"].unarchive.$post({ param: { id: thread.id } }));
      await rpcJson(response);
      await fetchAllThreads();
      toast.showToast(
        "success",
        archive ? t("routingStatus_archived") : t("routingStatus_active"),
      );
    } catch (error) {
      toast.showToast(
        "error",
        error instanceof Error ? error.message : t("failedToSave"),
      );
    }
  };

  const handleNewThreadCreated = (spaceId: string, thread: Thread) => {
    setThreadsBySpace((previous) => ({
      ...previous,
      [spaceId]: [thread, ...(previous[spaceId] ?? [])],
    }));
  };

  const handleSelectThread = (thread: Thread) => {
    const threadMap = threadsBySpaceSignal() ?? {};
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
      return threadsBySpaceSignal() ?? {};
    },
    setThreadsBySpace,
    get allThreads() {
      return allThreads();
    },
    fetchAllThreads,
    handleNewThread,
    handleDeleteThread,
    toggleArchiveThread,
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
