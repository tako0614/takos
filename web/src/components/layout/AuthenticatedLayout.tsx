import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { UnifiedSidebar } from "../navigation/UnifiedSidebar.tsx";
import {
  type SidebarCallbacks,
  SidebarContext,
} from "../navigation/SidebarContext.tsx";
import { MobileBottomNav, type NavItem } from "./MobileBottomNav.tsx";
import { MobileDrawer } from "./MobileDrawer.tsx";
import { MobileHeader } from "./MobileHeader.tsx";
import { getSpaceIdentifier } from "../../lib/spaces.ts";
import { useBreakpoint } from "../../hooks/useBreakpoint.ts";
import { useI18n } from "../../store/i18n.ts";
import { useAuth } from "../../hooks/useAuth.tsx";
import { buildStorageNavigationState } from "../../views/storage/storage-page-state.ts";
import { useModals } from "../../store/modal.tsx";
import { useNavigation } from "../../store/navigation.ts";
import type { View } from "../../types/index.ts";

function getMobileActiveItem(view: View): NavItem {
  switch (view) {
    case "apps":
      return "apps";
    case "store":
    case "repo":
      return "store";
    default:
      return "chat";
  }
}

export function AuthenticatedLayout(props: { children: JSX.Element }) {
  const { t } = useI18n();
  const breakpoint = useBreakpoint();
  const auth = useAuth();
  const modal = useModals();
  const navigation = useNavigation();

  const handleLogout = async () => {
    await auth.handleLogout();
    navigation.replace({ view: "home" });
  };

  const handleMobileNavigate = (item: NavItem) => {
    navigation.setShowMobileNavDrawer(false);
    switch (item) {
      case "apps":
        navigation.navigate({
          view: "apps",
          spaceId: navigation.selectedSpaceId ?? undefined,
          threadId: undefined,
        });
        break;
      case "chat":
        navigation.navigateToChat(navigation.selectedSpaceId ?? undefined);
        break;
      case "store":
        navigation.navigate({ view: "store", storeTab: "discover" });
        break;
    }
  };

  const sidebarCallbacks: SidebarCallbacks = {
    onNewChat: () =>
      navigation.runSidebarAction(() => {
        navigation.handleNewThread();
      }),
    onNavigateStorage: () =>
      navigation.runSidebarAction(() => {
        const spaceId = navigation.selectedSpaceId;
        if (!spaceId) return;
        navigation.navigate(buildStorageNavigationState(spaceId, "/"));
      }),
    onNavigateDeploy: () =>
      navigation.runSidebarAction(() => {
        navigation.navigate({
          view: "deploy",
          spaceId: navigation.selectedSpaceId ?? undefined,
        });
      }),
    onNavigateApps: () =>
      navigation.runSidebarAction(() => {
        navigation.navigate({
          view: "apps",
          spaceId: navigation.selectedSpaceId ?? undefined,
          threadId: undefined,
        });
      }),
    onNavigateStore: () =>
      navigation.runSidebarAction(() => {
        navigation.navigate({ view: "store", storeTab: "discover" });
      }),
    onNavigateRepos: () =>
      navigation.runSidebarAction(() => {
        navigation.navigate({
          view: "repos",
          spaceId: navigation.selectedSpaceId ?? undefined,
        });
      }),
    onOpenSearch: () =>
      navigation.runSidebarAction(() => {
        modal.setShowSearch(true);
      }),
    onCreateSpace: () =>
      navigation.runSidebarAction(() => {
        modal.setShowCreateSpace(true);
      }),
    onSelectThread: (thread) =>
      navigation.runSidebarAction(() => {
        navigation.handleSelectThread(thread);
      }),
    onDeleteThread: navigation.handleDeleteThread,
    onToggleArchiveThread: navigation.toggleArchiveThread,
    onOpenAgentModal: () =>
      navigation.runSidebarAction(() => {
        modal.setShowAgentModal(true);
      }),
    onOpenSpaceSettings: (wsId) =>
      navigation.runSidebarAction(() => {
        navigation.navigate({ view: "space-settings", spaceId: wsId });
      }),
    onOpenSettings: () =>
      navigation.runSidebarAction(() =>
        navigation.navigate({ view: "settings" })
      ),
    onLogout: () => navigation.runSidebarAction(handleLogout),
    onEnterSpace: (ws) =>
      navigation.runSidebarAction(() => {
        navigation.handleEnterSpace(ws);
      }),
    onExitSpace: () =>
      navigation.runSidebarAction(() => {
        navigation.handleExitSpace();
      }),
    onNavigateSpaceChat: () =>
      navigation.runSidebarAction(() => {
        if (!navigation.sidebarSpace) return;
        navigation.navigate({
          view: "chat",
          spaceId: getSpaceIdentifier(navigation.sidebarSpace),
          threadId: undefined,
          runId: undefined,
          messageId: undefined,
        });
      }),
    onNavigateSpaceStorage: () =>
      navigation.runSidebarAction(() => {
        if (!navigation.sidebarSpace) return;
        navigation.navigate(
          buildStorageNavigationState(
            getSpaceIdentifier(navigation.sidebarSpace),
            "/",
          ),
        );
      }),
    onNavigateSpaceDeploy: () =>
      navigation.runSidebarAction(() => {
        if (!navigation.sidebarSpace) return;
        navigation.navigate({
          view: "deploy",
          spaceId: getSpaceIdentifier(navigation.sidebarSpace),
        });
      }),
    onNavigateSpaceRepos: () =>
      navigation.runSidebarAction(() => {
        if (!navigation.sidebarSpace) return;
        navigation.navigate({
          view: "repos",
          spaceId: getSpaceIdentifier(navigation.sidebarSpace),
        });
      }),
    onNavigateSpaceApps: () =>
      navigation.runSidebarAction(() => {
        if (!navigation.sidebarSpace) return;
        navigation.navigate({
          view: "apps",
          spaceId: getSpaceIdentifier(navigation.sidebarSpace),
          threadId: undefined,
        });
      }),
    onNavigateSpaceSettings: () =>
      navigation.runSidebarAction(() => {
        if (!navigation.sidebarSpace) return;
        navigation.navigate({
          view: "space-settings",
          spaceId: getSpaceIdentifier(navigation.sidebarSpace),
        });
      }),
  };

  const sidebar = (
    <SidebarContext.Provider value={sidebarCallbacks}>
      <UnifiedSidebar
        activeView={navigation.route.view}
        spaceId={navigation.selectedSpaceId}
        spaces={auth.spaces}
        threads={navigation.allThreads}
        threadsBySpace={navigation.threadsBySpace}
        selectedThreadId={navigation.route.threadId ?? null}
        user={auth.user}
        sidebarSpace={navigation.sidebarSpace}
      />
    </SidebarContext.Provider>
  );

  return (
    <div class="flex flex-row h-[100dvh] w-screen overflow-hidden bg-white dark:bg-zinc-900">
      <Show when={!breakpoint.isMobile}>{sidebar}</Show>
      <Show when={breakpoint.isMobile}>
        <MobileDrawer
          isOpen={navigation.showMobileNavDrawer}
          onClose={() => navigation.setShowMobileNavDrawer(false)}
          title={t("menu")}
          panelId={navigation.mobileNavDrawerId}
        >
          {sidebar}
        </MobileDrawer>
      </Show>
      <Show when={breakpoint.isMobile}>
        <MobileHeader
          onOpenMenu={() => navigation.setShowMobileNavDrawer(true)}
          isMenuOpen={navigation.showMobileNavDrawer}
          menuControlsId={navigation.mobileNavDrawerId}
          menuAriaLabel={t("openMenu")}
        />
      </Show>
      <div
        class={`flex-1 flex flex-col min-h-0 ${
          breakpoint.isMobile
            ? "pb-[calc(var(--nav-height-mobile)+var(--spacing-safe-bottom))] pt-[calc(48px+var(--spacing-safe-top,0px))]"
            : ""
        }`}
      >
        {props.children}
      </div>
      <Show when={breakpoint.isMobile}>
        <MobileBottomNav
          activeItem={getMobileActiveItem(navigation.route.view)}
          onNavigate={handleMobileNavigate}
        />
      </Show>
    </div>
  );
}
