import { createEffect, createMemo } from "solid-js";
import {
  findSpaceByIdentifier,
  getPersonalSpace,
  getSpaceIdentifier,
} from "../lib/spaces.ts";
import { rpc, rpcJson } from "../lib/rpc.ts";
import { useBreakpoint } from "../hooks/useBreakpoint.ts";
import { useRouter } from "../hooks/useRouter.ts";
import { useAuth } from "../hooks/useAuth.tsx";
import { useI18n } from "./i18n.ts";
import { useToast } from "./toast.ts";
import { useConfirmDialog } from "./confirm-dialog.ts";
import type { Space, Thread } from "../types/index.ts";
import {
  fetchAllThreads as fetchAllThreadsAction,
  mobileNavDrawerId,
  useNavigationState,
} from "./navigation-atoms.ts";

export function useNavigationEffects() {
  const auth = useAuth();
  const router = useRouter();
  const breakpoint = useBreakpoint();
  const navigationState = useNavigationState();

  createEffect(() => {
    const currentSpaces = auth.spaces;
    if (currentSpaces.length === 0) {
      navigationState.setThreadsBySpace((prev) =>
        Object.keys(prev).length === 0 ? prev : {}
      );
      return;
    }
    void fetchAllThreadsAction(currentSpaces);
  });

  createEffect(() => {
    if (!breakpoint.isMobile) {
      navigationState.setShowMobileNavDrawer(false);
    }
  });

  createEffect(() => {
    if (!breakpoint.isMobile) return;
    void router.route;
    navigationState.setShowMobileNavDrawer(false);
  });
}

export function useNavigation() {
  const auth = useAuth();
  const router = useRouter();
  const i18n = useI18n();
  const breakpoint = useBreakpoint();
  const toast = useToast();
  const { confirm } = useConfirmDialog();
  const navigationState = useNavigationState();

  const personalLabel = createMemo(() => i18n.t("personal"));
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
    navigationState.setSidebarSpace(space);
    router.navigate({
      view: "chat",
      spaceId: getSpaceIdentifier(space),
      threadId: undefined,
      runId: undefined,
      messageId: undefined,
    });
  };

  const handleExitSpace = () => {
    navigationState.setSidebarSpace(null);
    router.replace({ view: "apps", spaceId: preferredSpaceId() });
  };

  const fetchAllThreads = async (wsList?: Space[]) => {
    await fetchAllThreadsAction(wsList ?? auth.spaces);
  };

  const handleNewThread = () => {
    const spaceId = preferredSpaceId();
    if (!spaceId) return;
    navigateToChat(spaceId);
  };

  const handleDeleteThread = async (threadId: string) => {
    const confirmed = await confirm({
      title: i18n.t("confirmDelete"),
      message: i18n.t("confirmDeleteThread"),
      confirmText: i18n.t("delete"),
      danger: true,
    });
    if (!confirmed) return;

    try {
      const res = await rpc.threads[":id"].$delete({ param: { id: threadId } });
      await rpcJson(res);
      navigationState.setThreadsBySpace((prev) => {
        const next: Record<string, Thread[]> = {};
        for (const key of Object.keys(prev)) {
          next[key] = prev[key].filter((thread) => thread.id !== threadId);
        }
        return next;
      });
      if (router.route.threadId === threadId) {
        navigateToChat(selectedSpaceId() ?? undefined);
      }
      toast.showToast("success", i18n.t("deleted"));
    } catch {
      toast.showToast("error", i18n.t("failedToDelete"));
    }
  };

  const toggleArchiveThread = async (thread: Thread) => {
    try {
      const endpoint = thread.status === "archived" ? "unarchive" : "archive";
      const res = await (endpoint === "archive"
        ? rpc.threads[":id"].archive.$post({ param: { id: thread.id } })
        : rpc.threads[":id"].unarchive.$post({ param: { id: thread.id } }));
      await rpcJson(res);
      await fetchAllThreads();
      toast.showToast(
        "success",
        endpoint === "archive"
          ? i18n.t("routingStatus_archived")
          : i18n.t("routingStatus_active"),
      );
    } catch (error) {
      toast.showToast(
        "error",
        error instanceof Error ? error.message : i18n.t("failedToSave"),
      );
    }
  };

  const handleNewThreadCreated = (spaceId: string, thread: Thread) => {
    navigationState.setThreadsBySpace((prev) => ({
      ...prev,
      [spaceId]: [thread, ...(prev[spaceId] ?? [])],
    }));
  };

  const handleSelectThread = (thread: Thread) => {
    for (
      const [spaceId, spaceThreads] of Object.entries(
        navigationState.threadsBySpace(),
      )
    ) {
      if (spaceThreads.some((candidate) => candidate.id === thread.id)) {
        navigateToChat(spaceId, thread.id);
        return;
      }
    }
    navigateToChat(selectedSpaceId() ?? undefined, thread.id);
  };

  const runSidebarAction = (action: () => void | Promise<void>) => {
    if (breakpoint.isMobile) {
      navigationState.setShowMobileNavDrawer(false);
    }
    void action();
  };

  return {
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
      return navigationState.sidebarSpace();
    },
    setSidebarSpace: navigationState.setSidebarSpace,
    handleEnterSpace,
    handleExitSpace,
    get showMobileNavDrawer() {
      return navigationState.showMobileNavDrawer();
    },
    setShowMobileNavDrawer: navigationState.setShowMobileNavDrawer,
    mobileNavDrawerId,
    get threadsBySpace() {
      return navigationState.threadsBySpace();
    },
    setThreadsBySpace: navigationState.setThreadsBySpace,
    get allThreads() {
      return navigationState.allThreads();
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
}
