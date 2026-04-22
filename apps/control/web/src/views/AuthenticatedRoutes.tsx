import { createMemo, createSignal } from "solid-js";
import type { JSX } from "solid-js";
import { ErrorBoundary } from "../components/ui/ErrorBoundary.tsx";
import { UserProfilePage } from "./profile/UserProfilePage.tsx";
import { LoadingScreen } from "../components/common/LoadingScreen.tsx";
import { AuthenticatedLayout } from "../components/layout/AuthenticatedLayout.tsx";
import { MemoryPage } from "./MemoryPage.tsx";
import { StoragePage } from "./storage/StoragePage.tsx";
import { buildStorageNavigationState } from "./storage/storage-page-state.ts";
import { SettingsView } from "./app/SettingsView.tsx";
import { DeployPanel } from "./app/space/DeployPanel.tsx";
import { SpaceSettingsPage } from "./hub/SpaceSettingsPage.tsx";
import { SourcePage } from "./source/SourcePage.tsx";
import { StoreManagementPage } from "./store/StoreManagementPage.tsx";
import { ReposPanel } from "./repos/ReposPanel.tsx";
import { ChatPage } from "./chat/ChatPage.tsx";
import { AppsPage } from "./apps/AppsPage.tsx";
import { RepoDetailPage } from "./repos/RepoDetailPage.tsx";
import { findSpaceByIdentifier, getSpaceIdentifier } from "../lib/spaces.ts";
import { buildPath } from "../hooks/router-state.ts";
import { useBreakpoint } from "../hooks/useBreakpoint.ts";
import { useI18n } from "../store/i18n.ts";
import { useAuth } from "../hooks/useAuth.tsx";
import { useNavigation } from "../store/navigation.ts";
import type {
  DeploySection,
  RouteState,
  Thread,
  View,
} from "../types/index.ts";

function SurfaceMessage(
  { title, description }: { title: string; description?: string },
) {
  return (
    <AuthenticatedLayout>
      <div class="flex-1 flex items-center justify-center px-6">
        <div class="max-w-md text-center space-y-2">
          <h1 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {title}
          </h1>
          {description
            ? (
              <p class="text-sm text-zinc-500 dark:text-zinc-400">
                {description}
              </p>
            )
            : null}
        </div>
      </div>
    </AuthenticatedLayout>
  );
}

export function AuthenticatedRoutes() {
  const i18n = useI18n();
  const breakpoint = useBreakpoint();
  const auth = useAuth();
  const navigation = useNavigation();

  const [deploySection, setDeploySection] = createSignal<DeploySection>(
    "workers",
  );
  const hasInvalidSpaceRoute = createMemo(() =>
    Boolean(navigation.route.spaceId) && !navigation.routeSpaceId &&
    auth.spacesLoaded
  );

  const ensureCanonicalRoute = (nextRoute: RouteState): boolean => {
    const canonicalPath = buildPath(nextRoute);
    if (
      `${globalThis.location.pathname}${globalThis.location.search}` ===
        canonicalPath
    ) {
      return false;
    }
    navigation.replace(nextRoute);
    return true;
  };

  const renderSpaceRouteError = () => (
    <SurfaceMessage
      title={i18n.t("spaceNotFound")}
      description={i18n.t("spaceNotFoundDesc")}
    />
  );

  const renderStoreView = () => {
    if (navigation.route.storeTab === "installed") {
      const storeSpaceId = navigation.routeSpaceId ??
        navigation.preferredSpaceId;
      if (!storeSpaceId) return <LoadingScreen />;
      return (
        <AuthenticatedLayout>
          <ErrorBoundary>
            <StoreManagementPage spaceId={storeSpaceId} />
          </ErrorBoundary>
        </AuthenticatedLayout>
      );
    }

    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          <SourcePage
            spaces={auth.spaces}
            onNavigateToRepo={(username, repoName) =>
              navigation.navigate({ view: "repo", username, repoName })}
            isAuthenticated
            onRequireLogin={auth.handleLogin}
          />
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderReposView = () => {
    if (navigation.waitingForSpaceResolution) return <LoadingScreen />;
    if (hasInvalidSpaceRoute()) return renderSpaceRouteError();
    const wsId = navigation.routeSpaceId ?? navigation.preferredSpaceId;

    if (!wsId && !auth.spacesLoaded) return <LoadingScreen />;
    if (!wsId) return <LoadingScreen />;

    if (ensureCanonicalRoute({ view: "repos", spaceId: wsId })) {
      return <LoadingScreen />;
    }

    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          <ReposPanel
            spaceId={wsId}
            onNavigateToRepo={(username, repoName) =>
              navigation.navigate({ view: "repo", username, repoName })}
          />
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderChatView = () => {
    const route = navigation.route;
    if (navigation.waitingForSpaceResolution) return <LoadingScreen />;
    if (hasInvalidSpaceRoute()) return renderSpaceRouteError();
    if (
      navigation.routeSpaceId && ensureCanonicalRoute({
        view: "chat",
        spaceId: navigation.routeSpaceId,
        threadId: route.threadId,
        runId: route.runId,
        messageId: route.messageId,
      })
    ) {
      return <LoadingScreen />;
    }
    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          <ChatPage
            spaces={auth.spaces}
            initialSpaceId={navigation.routeSpaceId}
            initialThreadId={route.threadId}
            initialRunId={route.runId}
            initialMessageId={route.messageId}
            onSpaceChange={(spaceId) => {
              navigation.navigateToChat(spaceId);
            }}
            onThreadChange={(threadId) => {
              if (navigation.routeSpaceId) {
                navigation.navigateToChat(navigation.routeSpaceId, threadId);
              }
            }}
            onUpdateThread={(threadId, updates) => {
              navigation.setThreadsBySpace((prev) => {
                const next: Record<string, Thread[]> = {};
                for (const key of Object.keys(prev)) {
                  next[key] = prev[key].map((th) =>
                    th.id === threadId ? { ...th, ...updates } : th
                  );
                }
                return next;
              });
            }}
            onNewThreadCreated={navigation.handleNewThreadCreated}
          />
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderDeployView = () => {
    if (navigation.waitingForSpaceResolution) return <LoadingScreen />;
    if (hasInvalidSpaceRoute()) return renderSpaceRouteError();
    const currentDeploySection = navigation.route.deploySection ||
      deploySection() ||
      "workers";
    const groupId = currentDeploySection === "groups"
      ? navigation.route.groupId
      : undefined;
    const deploySpaceId = navigation.routeSpaceId ??
      navigation.selectedSpaceId ??
      navigation.preferredSpaceId;

    if (!deploySpaceId && !auth.spacesLoaded) {
      return <LoadingScreen />;
    }

    if (
      deploySpaceId && ensureCanonicalRoute({
        view: "deploy",
        spaceId: deploySpaceId,
        deploySection: currentDeploySection,
        groupId,
      })
    ) {
      return <LoadingScreen />;
    }

    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          {deploySpaceId
            ? (
              <DeployPanel
                spaceId={deploySpaceId}
                spaces={auth.spaces}
                activeSection={currentDeploySection}
                groupId={groupId}
                onSectionChange={(section) => {
                  setDeploySection(section);
                  navigation.navigate({
                    view: "deploy",
                    spaceId: deploySpaceId,
                    deploySection: section,
                    groupId: undefined,
                  });
                }}
                onGroupSelect={(nextGroupId) =>
                  navigation.navigate({
                    view: "deploy",
                    spaceId: deploySpaceId,
                    deploySection: "groups",
                    groupId: nextGroupId ?? undefined,
                  })}
                user={auth.user}
                userSettings={auth.userSettings}
                onSettingsChange={auth.setUserSettings}
                onSpacesRefresh={auth.fetchSpaces}
                isMobile={breakpoint.isMobile}
              />
            )
            : (
              <div class="flex-1 flex items-center justify-center">
                <p class="text-zinc-500">No space available</p>
              </div>
            )}
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderRepoView = () => {
    const route = navigation.route;
    if (hasInvalidSpaceRoute()) return renderSpaceRouteError();
    const backSpace = navigation.routeSpaceId
      ? findSpaceByIdentifier(
        auth.spaces,
        navigation.routeSpaceId,
        i18n.t("personal"),
      )
      : navigation.preferredSpace;
    const backSpaceId = backSpace ? getSpaceIdentifier(backSpace) : undefined;

    if ((!route.username || !route.repoName) && !route.repoId) {
      navigation.replaceToChat();
      return <LoadingScreen />;
    }

    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          <RepoDetailPage
            spaceId={backSpaceId}
            repoId={route.repoId}
            username={route.username}
            repoName={route.repoName}
            initialFilePath={route.filePath}
            initialFileLine={route.fileLine}
            initialRef={route.ref}
            onBack={() => {
              navigation.navigateToChat(backSpaceId);
            }}
            isAuthenticated
            onRequireLogin={auth.handleLogin}
          />
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderMemoryView = () => {
    if (!navigation.preferredSpace) {
      return <LoadingScreen />;
    }

    return (
      <MemoryPage
        spaceId={getSpaceIdentifier(navigation.preferredSpace)}
        onBack={navigation.navigateToPreferredChat}
      />
    );
  };

  const renderStorageView = () => {
    const route = navigation.route;
    if (navigation.waitingForSpaceResolution) return <LoadingScreen />;
    if (hasInvalidSpaceRoute()) return renderSpaceRouteError();
    const storageSpaceId = navigation.routeSpaceId ??
      navigation.preferredSpaceId;

    if (!storageSpaceId && !auth.spacesLoaded) {
      return <LoadingScreen />;
    }
    if (!storageSpaceId) {
      return <LoadingScreen />;
    }

    if (
      ensureCanonicalRoute({
        view: "storage",
        spaceId: storageSpaceId,
        storagePath: route.storagePath,
        filePath: route.filePath,
        fileLine: route.fileLine,
      })
    ) {
      return <LoadingScreen />;
    }

    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          <StoragePage
            spaceId={storageSpaceId}
            spaces={auth.spaces}
            initialPath={route.storagePath || "/"}
            initialFilePath={route.filePath}
            onPathChange={(path) =>
              navigation.navigate(buildStorageNavigationState(
                storageSpaceId,
                path,
              ))}
          />
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderAppsView = () => {
    if (navigation.waitingForSpaceResolution) return <LoadingScreen />;
    if (hasInvalidSpaceRoute()) return renderSpaceRouteError();
    const appsSpaceId = navigation.routeSpaceId ?? navigation.preferredSpaceId;
    if (!appsSpaceId) {
      if (!auth.spacesLoaded) {
        return <LoadingScreen />;
      }
      return (
        <AuthenticatedLayout>
          <div class="flex-1 flex items-center justify-center">
            <p class="text-zinc-500">No space available</p>
          </div>
        </AuthenticatedLayout>
      );
    }

    if (ensureCanonicalRoute({ view: "apps", spaceId: appsSpaceId })) {
      return <LoadingScreen />;
    }

    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          <AppsPage
            spaceId={appsSpaceId}
            onNavigateToStore={() =>
              navigation.navigate({ view: "store", storeTab: "discover" })}
          />
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderSpaceSettingsView = () => {
    if (navigation.waitingForSpaceResolution) return <LoadingScreen />;
    if (hasInvalidSpaceRoute()) return renderSpaceRouteError();
    const wsId = navigation.routeSpaceId ?? navigation.selectedSpaceId ?? null;
    if (
      ensureCanonicalRoute({
        view: "space-settings",
        spaceId: wsId ?? undefined,
      })
    ) {
      return <LoadingScreen />;
    }
    return (
      <AuthenticatedLayout>
        <ErrorBoundary>
          <SpaceSettingsPage
            spaces={auth.spaces}
            initialSpaceId={wsId}
            onSpaceDeleted={() => auth.fetchSpaces(auth.user)}
            onSpaceUpdated={() => auth.fetchSpaces(auth.user)}
          />
        </ErrorBoundary>
      </AuthenticatedLayout>
    );
  };

  const renderSettingsView = () => (
    <AuthenticatedLayout>
      <ErrorBoundary>
        <SettingsView
          user={auth.user}
          userSettings={auth.userSettings}
          onSettingsChange={auth.setUserSettings}
          onBack={() => navigation.navigateToPreferredChat()}
        />
      </ErrorBoundary>
    </AuthenticatedLayout>
  );

  const renderLegacyAppView = () => {
    if (hasInvalidSpaceRoute()) return renderSpaceRouteError();
    if (!navigation.route.appId) {
      navigation.replace({
        view: "apps",
        spaceId: navigation.preferredSpaceId,
      });
    }
    return <LoadingScreen />;
  };

  const renderHomeRedirectView = () => {
    navigation.replace({ view: "apps", spaceId: navigation.preferredSpaceId });
    return <LoadingScreen />;
  };

  const renderProfileView = (): JSX.Element | undefined => {
    if (!navigation.route.username) {
      return undefined;
    }

    return (
      <UserProfilePage
        username={navigation.route.username}
        onBack={navigation.navigateToPreferredChat}
        onNavigateToProfile={(username) =>
          navigation.navigate({ view: "profile", username })}
        onNavigateToRepo={(username, repoName) => {
          navigation.navigate({ view: "repo", username, repoName });
        }}
      />
    );
  };

  type AuthenticatedView = View;
  type AuthenticatedViewRenderer = () => JSX.Element | undefined;

  const authenticatedViewRenderers: Partial<
    Record<AuthenticatedView, AuthenticatedViewRenderer>
  > = {
    home: renderHomeRedirectView,
    store: renderStoreView,
    repos: renderReposView,
    chat: renderChatView,
    deploy: renderDeployView,
    repo: renderRepoView,
    profile: renderProfileView,
    memory: renderMemoryView,
    storage: renderStorageView,
    apps: renderAppsView,
    app: renderLegacyAppView,
    "space-settings": renderSpaceSettingsView,
    settings: renderSettingsView,
  };

  const content = createMemo<JSX.Element>(() => {
    const renderer =
      authenticatedViewRenderers[navigation.route.view as AuthenticatedView];
    if (renderer) {
      const rendered = renderer();
      if (rendered !== undefined) {
        return <>{rendered}</>;
      }
    }

    navigation.replace({ view: "apps", spaceId: navigation.preferredSpaceId });
    return <LoadingScreen />;
  });

  return content();
}
