import {
  createEffect,
  createMemo,
  type JSX,
  lazy,
  Match,
  Suspense,
  Switch,
} from "solid-js";
import { Navigate, Route, useLocation, useParams } from "@solidjs/router";
import { LoadingScreen } from "./components/common/LoadingScreen.tsx";
import { Button } from "./components/ui/Button.tsx";
import { ErrorBoundary } from "./components/ui/ErrorBoundary.tsx";
import {
  type AppRouteComponentKey,
  FALLBACK_APP_ROUTE_SCHEMAS,
  PROTECTED_APP_ROUTE_SCHEMAS,
  PUBLIC_APP_ROUTE_SCHEMAS,
} from "./app-route-schema.ts";
import { useAuth } from "./hooks/useAuth.tsx";
import { useAppRouteResolver } from "./hooks/useAppRouteResolver.ts";
import { buildPath } from "./hooks/router-state.ts";
import { rpc } from "./lib/rpc.ts";
import { findSpaceByIdentifier, getSpaceIdentifier } from "./lib/spaces.ts";
import { useBreakpoint } from "./hooks/useBreakpoint.ts";
import { useNavigation } from "./store/navigation.ts";
import { useI18n } from "./store/i18n.ts";
import { buildStorageNavigationState } from "./views/storage/storage-page-state.ts";
import type {
  DeploySection,
  RouteState,
  Thread,
  UserSettings,
} from "./types/index.ts";
import { SetupPage } from "./views/SetupPage.tsx";
import { LoginPage } from "./views/app/AuthViews.tsx";
import { AuthenticatedLayout } from "./components/layout/AuthenticatedLayout.tsx";

const SourcePage = lazy(() =>
  import("./views/source/SourcePage.tsx").then((module) => ({
    default: module.SourcePage,
  }))
);
const RepoDetailPage = lazy(() =>
  import("./views/repos/RepoDetailPage.tsx").then((module) => ({
    default: module.RepoDetailPage,
  }))
);
const ChatPage = lazy(() =>
  import("./views/chat/ChatPage.tsx").then((module) => ({
    default: module.ChatPage,
  }))
);
const AppsPage = lazy(() =>
  import("./views/apps/AppsPage.tsx").then((module) => ({
    default: module.AppsPage,
  }))
);
const ReposPanel = lazy(() =>
  import("./views/repos/ReposPanel.tsx").then((module) => ({
    default: module.ReposPanel,
  }))
);
const DeployPanel = lazy(() =>
  import("./views/app/space/DeployPanel.tsx").then((module) => ({
    default: module.DeployPanel,
  }))
);
const StoragePage = lazy(() =>
  import("./views/storage/StoragePage.tsx").then((module) => ({
    default: module.StoragePage,
  }))
);
const StoreManagementPage = lazy(() =>
  import("./views/store/StoreManagementPage.tsx").then((module) => ({
    default: module.StoreManagementPage,
  }))
);
const SpaceSettingsPage = lazy(() =>
  import("./views/hub/SpaceSettingsPage.tsx").then((module) => ({
    default: module.SpaceSettingsPage,
  }))
);
const SettingsView = lazy(() =>
  import("./views/app/SettingsView.tsx").then((module) => ({
    default: module.SettingsView,
  }))
);
const MemoryPage = lazy(() =>
  import("./views/MemoryPage.tsx").then((module) => ({
    default: module.MemoryPage,
  }))
);
const UserProfilePage = lazy(() =>
  import("./views/profile/UserProfilePage.tsx").then((module) => ({
    default: module.UserProfilePage,
  }))
);
const LegalPage = lazy(() =>
  import("./views/legal/LegalPage.tsx").then((module) => ({
    default: module.LegalPage,
  }))
);
const SharedThreadPage = lazy(() =>
  import("./views/share/SharedThreadPage.tsx").then((module) => ({
    default: module.SharedThreadPage,
  }))
);
const OAuthConsentView = lazy(() =>
  import("./views/oauth/OAuthConsentView.tsx").then((module) => ({
    default: module.OAuthConsentView,
  }))
);
const DeviceAuthView = lazy(() =>
  import("./views/oauth/DeviceAuthView.tsx").then((module) => ({
    default: module.DeviceAuthView,
  }))
);

function BootstrapErrorScreen(props: {
  title: string;
  message: string;
  retryLabel: string;
  loginLabel: string;
  onRetry: () => void;
  onLogin: () => void;
}) {
  return (
    <div class="min-h-screen bg-white dark:bg-zinc-900 flex items-center justify-center px-6">
      <div class="w-full max-w-md rounded-2xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 p-6 shadow-sm space-y-4">
        <div class="space-y-2 text-center">
          <h1 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {props.title}
          </h1>
          <p class="text-sm text-zinc-500 dark:text-zinc-400">
            {props.message}
          </p>
        </div>
        <div class="flex flex-col gap-3">
          <Button onClick={props.onRetry}>{props.retryLabel}</Button>
          <Button variant="secondary" onClick={props.onLogin}>
            {props.loginLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}

function RouteSurface(props: { children: JSX.Element }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingScreen />}>
        {props.children}
      </Suspense>
    </ErrorBoundary>
  );
}

function SurfaceMessage(
  props: { title: string; description?: string },
) {
  return (
    <div class="flex-1 flex items-center justify-center px-6">
      <div class="max-w-md text-center space-y-2">
        <h1 class="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {props.title}
        </h1>
        {props.description
          ? (
            <p class="text-sm text-zinc-500 dark:text-zinc-400">
              {props.description}
            </p>
          )
          : null}
      </div>
    </div>
  );
}

function useCurrentPath() {
  const location = useLocation();
  return createMemo(() => `${location.pathname}${location.search}`);
}

function useCanonicalHref(nextRoute: () => RouteState | null) {
  const currentPath = useCurrentPath();
  return createMemo(() => {
    const route = nextRoute();
    if (!route) {
      return null;
    }
    const path = buildPath(route);
    return path !== currentPath() ? path : null;
  });
}

async function completeSetup(auth: ReturnType<typeof useAuth>) {
  try {
    await rpc.me.settings.$patch({
      json: { setup_completed: true, auto_update_enabled: true },
    });
  } catch {
    // ignored
  }
  await auth.fetchUser();
}

function AuthLoadingGate() {
  const auth = useAuth();
  const { t } = useI18n();
  const currentPath = useCurrentPath();

  return (
    <Switch fallback={<LoadingScreen />}>
      <Match when={auth.bootstrapError}>
        <BootstrapErrorScreen
          title={t("failedToLoad")}
          message={auth.bootstrapError!}
          retryLabel={t("refresh")}
          loginLabel={t("continueWithGoogle")}
          onRetry={() => {
            void auth.fetchUser();
          }}
          onLogin={() => auth.redirectToLogin(currentPath())}
        />
      </Match>
    </Switch>
  );
}

function ProtectedRouteLayout(props: { children?: JSX.Element }) {
  const auth = useAuth();
  const currentPath = useCurrentPath();

  return (
    <Switch
      fallback={<AuthenticatedLayout>{props.children}</AuthenticatedLayout>}
    >
      <Match when={auth.authState === "loading"}>
        <AuthLoadingGate />
      </Match>
      <Match when={auth.authState === "login"}>
        <LoginPage onLogin={() => auth.redirectToLogin(currentPath())} />
      </Match>
      <Match when={auth.user && !auth.user.setup_completed}>
        <SetupPage onComplete={() => completeSetup(auth)} />
      </Match>
    </Switch>
  );
}

function HomeRoute() {
  const auth = useAuth();
  const navigation = useNavigation();
  const currentPath = useCurrentPath();
  const targetRoute = createMemo<RouteState | null>(() => {
    if (
      auth.authState !== "authenticated" || !auth.user ||
      !auth.user.setup_completed
    ) {
      return null;
    }
    return {
      view: "apps",
      spaceId: navigation.preferredSpaceId,
    };
  });
  const canonicalHref = useCanonicalHref(targetRoute);

  return (
    <Switch fallback={<LoadingScreen />}>
      <Match when={auth.authState === "loading"}>
        <AuthLoadingGate />
      </Match>
      <Match when={auth.authState === "login"}>
        <LoginPage onLogin={() => auth.redirectToLogin(currentPath())} />
      </Match>
      <Match when={auth.user && !auth.user.setup_completed}>
        <SetupPage onComplete={() => completeSetup(auth)} />
      </Match>
      <Match when={canonicalHref()}>
        <Navigate href={canonicalHref()!} />
      </Match>
    </Switch>
  );
}

function SpaceNotFoundMessage() {
  const { t } = useI18n();
  return (
    <SurfaceMessage
      title={t("spaceNotFound")}
      description={t("spaceNotFoundDesc")}
    />
  );
}

function NoSpaceAvailableMessage() {
  const { t } = useI18n();

  return (
    <div class="flex-1 flex items-center justify-center">
      <p class="text-zinc-500">{t("noSpaceAvailable")}</p>
    </div>
  );
}

function useSpaceRouteGuard(
  nextRoute: () => RouteState | null,
  route: () => RouteState,
) {
  const auth = useAuth();
  const navigation = useNavigation();
  const canonicalHref = useCanonicalHref(nextRoute);
  const hasInvalidSpaceRoute = createMemo(() =>
    Boolean(route().spaceId) && !navigation.routeSpaceId && auth.spacesLoaded
  );

  return {
    canonicalHref,
    hasInvalidSpaceRoute,
    isPending: createMemo(() => navigation.waitingForSpaceResolution),
  };
}

function StoreRoute() {
  const auth = useAuth();
  const navigation = useNavigation();
  const currentPath = useCurrentPath();
  const route = createMemo(() => navigation.route);
  const storeTab = createMemo(() => route().storeTab || "discover");
  const canonicalHref = useCanonicalHref(() => ({
    view: "store",
    storeTab: storeTab(),
  }));
  const storeSpaceId = createMemo(() =>
    navigation.routeSpaceId ?? navigation.preferredSpaceId
  );

  return (
    <Switch
      fallback={
        <RouteSurface>
          <SourcePage
            spaces={[]}
            onNavigateToRepo={(username: string, repoName: string) =>
              navigation.navigate({ view: "repo", username, repoName })}
            isAuthenticated={false}
            onRequireLogin={() => auth.redirectToLogin(currentPath())}
          />
        </RouteSurface>
      }
    >
      <Match when={canonicalHref()}>
        <Navigate href={canonicalHref()!} />
      </Match>
      <Match when={auth.authState === "loading"}>
        <AuthLoadingGate />
      </Match>
      <Match
        when={auth.authState === "authenticated" && storeTab() === "installed"}
      >
        <AuthenticatedLayout>
          <Switch>
            <Match when={storeSpaceId()}>
              <RouteSurface>
                <StoreManagementPage spaceId={storeSpaceId()!} />
              </RouteSurface>
            </Match>
            <Match when={!auth.spacesLoaded}>
              <LoadingScreen />
            </Match>
            <Match when={auth.spacesLoaded}>
              <NoSpaceAvailableMessage />
            </Match>
          </Switch>
        </AuthenticatedLayout>
      </Match>
      <Match when={auth.authState === "authenticated"}>
        <AuthenticatedLayout>
          <RouteSurface>
            <SourcePage
              spaces={auth.spaces}
              onNavigateToRepo={(username: string, repoName: string) =>
                navigation.navigate({ view: "repo", username, repoName })}
              isAuthenticated
              onRequireLogin={() => auth.redirectToLogin(currentPath())}
            />
          </RouteSurface>
        </AuthenticatedLayout>
      </Match>
    </Switch>
  );
}

function RepoRoute() {
  const auth = useAuth();
  const navigation = useNavigation();
  const { t } = useI18n();
  const currentPath = useCurrentPath();
  const route = createMemo(() => navigation.route);
  const hasInvalidSpaceRoute = createMemo(() =>
    Boolean(route().spaceId) && !navigation.routeSpaceId && auth.spacesLoaded
  );
  const backSpace = createMemo(() =>
    navigation.routeSpaceId
      ? findSpaceByIdentifier(
        auth.spaces,
        navigation.routeSpaceId,
        t("personal"),
      )
      : navigation.preferredSpace
  );
  const backSpaceId = createMemo(() => {
    const space = backSpace();
    return space ? getSpaceIdentifier(space) : undefined;
  });

  return (
    <Switch
      fallback={
        <RouteSurface>
          <RepoDetailPage
            repoId={route().repoId}
            username={route().username}
            repoName={route().repoName}
            initialFilePath={route().filePath}
            initialFileLine={route().fileLine}
            initialRef={route().ref}
            onBack={() =>
              navigation.navigate({ view: "store", storeTab: "discover" })}
            isAuthenticated={false}
            onRequireLogin={() => auth.redirectToLogin(currentPath())}
          />
        </RouteSurface>
      }
    >
      <Match when={auth.authState === "loading"}>
        <AuthLoadingGate />
      </Match>
      <Match
        when={auth.authState === "authenticated" && hasInvalidSpaceRoute()}
      >
        <AuthenticatedLayout>
          <SpaceNotFoundMessage />
        </AuthenticatedLayout>
      </Match>
      <Match when={auth.authState === "authenticated"}>
        <AuthenticatedLayout>
          <RouteSurface>
            <RepoDetailPage
              spaceId={backSpaceId()}
              repoId={route().repoId}
              username={route().username}
              repoName={route().repoName}
              initialFilePath={route().filePath}
              initialFileLine={route().fileLine}
              initialRef={route().ref}
              onBack={() => {
                navigation.navigateToChat(backSpaceId());
              }}
              isAuthenticated
              onRequireLogin={() => auth.redirectToLogin(currentPath())}
            />
          </RouteSurface>
        </AuthenticatedLayout>
      </Match>
    </Switch>
  );
}

function ChatRoute() {
  const auth = useAuth();
  const navigation = useNavigation();
  const route = createMemo(() => navigation.route);
  const guard = useSpaceRouteGuard(() => {
    if (!navigation.routeSpaceId) {
      return null;
    }
    return {
      view: "chat",
      spaceId: navigation.routeSpaceId,
      threadId: route().threadId,
      runId: route().runId,
      messageId: route().messageId,
    };
  }, route);

  return (
    <Switch>
      <Match when={guard.canonicalHref()}>
        <Navigate href={guard.canonicalHref()!} />
      </Match>
      <Match when={guard.isPending()}>
        <LoadingScreen />
      </Match>
      <Match when={guard.hasInvalidSpaceRoute()}>
        <SpaceNotFoundMessage />
      </Match>
      <Match when>
        <RouteSurface>
          <ChatPage
            spaces={auth.spaces}
            initialSpaceId={navigation.routeSpaceId}
            initialThreadId={route().threadId}
            initialRunId={route().runId}
            initialMessageId={route().messageId}
            onSpaceChange={(spaceId: string) => {
              navigation.navigateToChat(spaceId);
            }}
            onThreadChange={(threadId: string | undefined) => {
              const spaceId = navigation.routeSpaceId ??
                navigation.selectedSpaceId ?? navigation.preferredSpaceId;
              if (spaceId) {
                navigation.navigateToChat(spaceId, threadId);
              }
            }}
            onUpdateThread={(threadId: string, updates: Partial<Thread>) => {
              navigation.setThreadsBySpace((previous) => {
                const next: Record<string, Thread[]> = {};
                for (const key of Object.keys(previous)) {
                  next[key] = previous[key].map((thread) =>
                    thread.id === threadId ? { ...thread, ...updates } : thread
                  );
                }
                return next;
              });
            }}
            onNewThreadCreated={navigation.handleNewThreadCreated}
          />
        </RouteSurface>
      </Match>
    </Switch>
  );
}

function ReposRoute() {
  const auth = useAuth();
  const navigation = useNavigation();
  const route = createMemo(() => navigation.route);
  const resolvedSpaceId = createMemo(() =>
    navigation.routeSpaceId ?? navigation.preferredSpaceId
  );
  const guard = useSpaceRouteGuard(() => {
    const spaceId = resolvedSpaceId();
    return spaceId ? { view: "repos", spaceId } : null;
  }, route);

  return (
    <Switch>
      <Match when={guard.canonicalHref()}>
        <Navigate href={guard.canonicalHref()!} />
      </Match>
      <Match when={guard.isPending()}>
        <LoadingScreen />
      </Match>
      <Match when={guard.hasInvalidSpaceRoute()}>
        <SpaceNotFoundMessage />
      </Match>
      <Match when={!resolvedSpaceId() && !auth.spacesLoaded}>
        <LoadingScreen />
      </Match>
      <Match when={!resolvedSpaceId()}>
        <NoSpaceAvailableMessage />
      </Match>
      <Match when={resolvedSpaceId()}>
        <RouteSurface>
          <ReposPanel
            spaceId={resolvedSpaceId()!}
            onNavigateToRepo={(username: string, repoName: string) =>
              navigation.navigate({ view: "repo", username, repoName })}
          />
        </RouteSurface>
      </Match>
    </Switch>
  );
}

function GroupsRoute() {
  const auth = useAuth();
  const navigation = useNavigation();
  const route = createMemo(() => navigation.route);
  const groupId = createMemo(() => route().groupId);
  const groupsSpaceId = createMemo(() =>
    navigation.routeSpaceId ?? navigation.selectedSpaceId ??
      navigation.preferredSpaceId
  );
  const guard = useSpaceRouteGuard(() => {
    const spaceId = groupsSpaceId();
    return spaceId
      ? { view: "deploy", spaceId, deploySection: "groups", groupId: groupId() }
      : null;
  }, route);
  const redirectHref = createMemo(() => {
    const spaceId = groupsSpaceId();
    return buildPath({
      view: "deploy",
      spaceId: spaceId ?? undefined,
      deploySection: "groups",
      groupId: groupId(),
    });
  });

  return (
    <Switch>
      <Match when={guard.canonicalHref()}>
        <Navigate href={guard.canonicalHref()!} />
      </Match>
      <Match when={guard.isPending()}>
        <LoadingScreen />
      </Match>
      <Match when={guard.hasInvalidSpaceRoute()}>
        <SpaceNotFoundMessage />
      </Match>
      <Match when={!groupsSpaceId() && !auth.spacesLoaded}>
        <LoadingScreen />
      </Match>
      <Match when={!groupsSpaceId()}>
        <NoSpaceAvailableMessage />
      </Match>
      <Match when={groupsSpaceId()}>
        <Navigate href={redirectHref()} />
      </Match>
    </Switch>
  );
}

function DeployRoute() {
  const auth = useAuth();
  const navigation = useNavigation();
  const breakpoint = useBreakpoint();
  const route = createMemo(() => navigation.route);
  const currentDeploySection = createMemo(() =>
    navigation.route.deploySection || "workers"
  );
  const groupId = createMemo(() =>
    currentDeploySection() === "groups" ? route().groupId : undefined
  );
  const deploySpaceId = createMemo(() =>
    navigation.routeSpaceId ?? navigation.selectedSpaceId ??
      navigation.preferredSpaceId
  );
  const guard = useSpaceRouteGuard(() => ({
    view: "deploy",
    spaceId: deploySpaceId() ?? undefined,
    deploySection: currentDeploySection(),
    groupId: groupId(),
  }), route);

  return (
    <Switch>
      <Match when={guard.canonicalHref()}>
        <Navigate href={guard.canonicalHref()!} />
      </Match>
      <Match when={guard.isPending()}>
        <LoadingScreen />
      </Match>
      <Match when={guard.hasInvalidSpaceRoute()}>
        <SpaceNotFoundMessage />
      </Match>
      <Match when={!deploySpaceId() && !auth.spacesLoaded}>
        <LoadingScreen />
      </Match>
      <Match when>
        <RouteSurface>
          {deploySpaceId()
            ? (
              <DeployPanel
                spaceId={deploySpaceId()!}
                spaces={auth.spaces}
                activeSection={currentDeploySection()}
                groupId={groupId()}
                onSectionChange={(section: DeploySection) => {
                  navigation.navigate({
                    view: "deploy",
                    spaceId: deploySpaceId() ?? undefined,
                    deploySection: section,
                    groupId: undefined,
                  });
                }}
                onGroupSelect={(nextGroupId) =>
                  navigation.navigate({
                    view: "deploy",
                    spaceId: deploySpaceId() ?? undefined,
                    deploySection: "groups",
                    groupId: nextGroupId ?? undefined,
                  })}
                user={auth.user}
                userSettings={auth.userSettings}
                onSettingsChange={(settings: UserSettings) =>
                  auth.setUserSettings(settings)}
                onSpacesRefresh={() => {
                  void auth.fetchSpaces(auth.user);
                }}
                isMobile={breakpoint.isMobile}
              />
            )
            : <NoSpaceAvailableMessage />}
        </RouteSurface>
      </Match>
    </Switch>
  );
}

function StorageRoute() {
  const auth = useAuth();
  const navigation = useNavigation();
  const route = createMemo(() => navigation.route);
  const storageSpaceId = createMemo(() =>
    navigation.routeSpaceId ?? navigation.preferredSpaceId
  );
  const guard = useSpaceRouteGuard(() => {
    const spaceId = storageSpaceId();
    if (!spaceId) {
      return null;
    }
    return {
      view: "storage",
      spaceId,
      storagePath: route().storagePath,
      filePath: route().filePath,
      fileLine: route().fileLine,
    };
  }, route);

  return (
    <Switch>
      <Match when={guard.canonicalHref()}>
        <Navigate href={guard.canonicalHref()!} />
      </Match>
      <Match when={guard.isPending()}>
        <LoadingScreen />
      </Match>
      <Match when={guard.hasInvalidSpaceRoute()}>
        <SpaceNotFoundMessage />
      </Match>
      <Match when={!storageSpaceId() && !auth.spacesLoaded}>
        <LoadingScreen />
      </Match>
      <Match when={!storageSpaceId()}>
        <NoSpaceAvailableMessage />
      </Match>
      <Match when={storageSpaceId()}>
        <RouteSurface>
          <StoragePage
            spaceId={storageSpaceId()!}
            spaces={auth.spaces}
            initialPath={route().storagePath || "/"}
            initialFilePath={route().filePath}
            onPathChange={(path: string) =>
              navigation.navigate(
                buildStorageNavigationState(storageSpaceId()!, path),
              )}
          />
        </RouteSurface>
      </Match>
    </Switch>
  );
}

function AppsRoute() {
  const auth = useAuth();
  const navigation = useNavigation();
  const route = createMemo(() => navigation.route);
  const appsSpaceId = createMemo(() =>
    navigation.routeSpaceId ?? navigation.preferredSpaceId
  );
  const guard = useSpaceRouteGuard(() => ({
    view: "apps",
    spaceId: appsSpaceId() ?? undefined,
  }), route);

  return (
    <Switch>
      <Match when={guard.canonicalHref()}>
        <Navigate href={guard.canonicalHref()!} />
      </Match>
      <Match when={guard.isPending()}>
        <LoadingScreen />
      </Match>
      <Match when={guard.hasInvalidSpaceRoute()}>
        <SpaceNotFoundMessage />
      </Match>
      <Match when={!appsSpaceId() && !auth.spacesLoaded}>
        <LoadingScreen />
      </Match>
      <Match when={!appsSpaceId()}>
        <NoSpaceAvailableMessage />
      </Match>
      <Match when={appsSpaceId()}>
        <RouteSurface>
          <AppsPage
            spaceId={appsSpaceId()!}
            onNavigateToStore={() =>
              navigation.navigate({ view: "store", storeTab: "discover" })}
          />
        </RouteSurface>
      </Match>
    </Switch>
  );
}

function SpaceSettingsRoute() {
  const auth = useAuth();
  const navigation = useNavigation();
  const route = createMemo(() => navigation.route);
  const selectedSpaceId = createMemo(() =>
    navigation.routeSpaceId ?? navigation.selectedSpaceId ?? null
  );
  const guard = useSpaceRouteGuard(() => ({
    view: "space-settings",
    spaceId: selectedSpaceId() ?? undefined,
  }), route);

  return (
    <Switch>
      <Match when={guard.canonicalHref()}>
        <Navigate href={guard.canonicalHref()!} />
      </Match>
      <Match when={guard.isPending()}>
        <LoadingScreen />
      </Match>
      <Match when={guard.hasInvalidSpaceRoute()}>
        <SpaceNotFoundMessage />
      </Match>
      <Match when>
        <RouteSurface>
          <SpaceSettingsPage
            spaces={auth.spaces}
            initialSpaceId={selectedSpaceId()}
            onSpaceDeleted={() => {
              void auth.fetchSpaces(auth.user);
            }}
            onSpaceUpdated={() => {
              void auth.fetchSpaces(auth.user);
            }}
          />
        </RouteSurface>
      </Match>
    </Switch>
  );
}

function SettingsRoute() {
  const auth = useAuth();
  const navigation = useNavigation();

  return (
    <RouteSurface>
      <SettingsView
        user={auth.user}
        userSettings={auth.userSettings}
        onSettingsChange={(settings: UserSettings) =>
          auth.setUserSettings(settings)}
        onBack={() => navigation.navigateToPreferredChat()}
      />
    </RouteSurface>
  );
}

function MemoryRoute() {
  const auth = useAuth();
  const navigation = useNavigation();
  const preferredSpaceId = createMemo(() => {
    const space = navigation.preferredSpace;
    return space ? getSpaceIdentifier(space) : undefined;
  });

  return (
    <Switch>
      <Match when={preferredSpaceId()}>
        <RouteSurface>
          <MemoryPage
            spaceId={preferredSpaceId()!}
            onBack={navigation.navigateToPreferredChat}
          />
        </RouteSurface>
      </Match>
      <Match when={!auth.spacesLoaded}>
        <LoadingScreen />
      </Match>
      <Match when={auth.spacesLoaded}>
        <NoSpaceAvailableMessage />
      </Match>
    </Switch>
  );
}

function ProfileRoute() {
  const navigation = useNavigation();
  const route = createMemo(() => navigation.route);

  return (
    <Switch fallback={<LoadingScreen />}>
      <Match when={route().username}>
        <RouteSurface>
          <UserProfilePage
            username={route().username!}
            onBack={navigation.navigateToPreferredChat}
            onNavigateToProfile={(username: string) =>
              navigation.navigate({ view: "profile", username })}
            onNavigateToRepo={(username: string, repoName: string) => {
              navigation.navigate({ view: "repo", username, repoName });
            }}
          />
        </RouteSurface>
      </Match>
    </Switch>
  );
}

function LegacyAppShortcutRoute(props: { target: () => RouteState }) {
  const canonicalHref = useCanonicalHref(props.target);
  return (
    <Switch fallback={<LoadingScreen />}>
      <Match when={canonicalHref()}>
        <Navigate href={canonicalHref()!} />
      </Match>
    </Switch>
  );
}

function ExternalRedirect(props: { href: string }) {
  createEffect(() => {
    globalThis.location.assign(props.href);
  });
  return <LoadingScreen />;
}

function LegacyAppRoute() {
  const auth = useAuth();
  const navigation = useNavigation();
  const i18n = useI18n();
  const route = createMemo(() => navigation.route);

  const resolver = useAppRouteResolver({
    authState: () => auth.authState,
    route,
    hasInvalidSpaceRoute: () =>
      Boolean(route().spaceId) && !navigation.routeSpaceId &&
      auth.spacesLoaded,
    routeSpaceId: () => navigation.routeSpaceId,
    selectedSpaceId: () => navigation.selectedSpaceId,
    preferredSpaceId: () => navigation.preferredSpaceId,
    spaces: () => auth.spaces,
    personalLabel: () => i18n.t("personal"),
  });

  const externalHref = createMemo(() => resolver.resolution()?.externalHref);
  const targetRoute = createMemo(() => resolver.resolution()?.targetRoute);

  return (
    <Switch fallback={<LoadingScreen />}>
      <Match when={externalHref()}>
        <ExternalRedirect href={externalHref()!} />
      </Match>
      <Match when={targetRoute()}>
        <Navigate href={buildPath(targetRoute()!)} />
      </Match>
      <Match when={resolver.resolving()}>
        <LoadingScreen />
      </Match>
    </Switch>
  );
}

function OAuthAuthorizeRoute() {
  return (
    <RouteSurface>
      <OAuthConsentView />
    </RouteSurface>
  );
}

function OAuthDeviceRoute() {
  return (
    <RouteSurface>
      <DeviceAuthView />
    </RouteSurface>
  );
}

function ShareRoute() {
  const params = useParams<{ token?: string }>();
  return (
    <Switch fallback={<LoadingScreen />}>
      <Match when={params.token}>
        <RouteSurface>
          <SharedThreadPage token={params.token!} />
        </RouteSurface>
      </Match>
    </Switch>
  );
}

function createLegalRoute(page: "terms" | "privacy" | "tokushoho") {
  return function LegalRoute() {
    return (
      <RouteSurface>
        <LegalPage page={page} />
      </RouteSurface>
    );
  };
}

function createLegacyShortcutRoute(target: RouteState) {
  return function LegacyShortcutRoute() {
    return <LegacyAppShortcutRoute target={() => target} />;
  };
}

const TermsRoute = createLegalRoute("terms");
const PrivacyRoute = createLegalRoute("privacy");
const TokushohoRoute = createLegalRoute("tokushoho");
const LegacyAppStoreRoute = createLegacyShortcutRoute({
  view: "store",
  storeTab: "discover",
});
const LegacyAppReposRoute = createLegacyShortcutRoute({ view: "repos" });
const LegacyAppWorkersRoute = createLegacyShortcutRoute({
  view: "deploy",
  deploySection: "workers",
});
const LegacyAppResourcesRoute = createLegacyShortcutRoute({
  view: "deploy",
  deploySection: "resources",
});

const ROUTE_COMPONENTS: Record<AppRouteComponentKey, () => JSX.Element> = {
  "oauth-authorize": OAuthAuthorizeRoute,
  "oauth-device": OAuthDeviceRoute,
  terms: TermsRoute,
  privacy: PrivacyRoute,
  tokushoho: TokushohoRoute,
  share: ShareRoute,
  store: StoreRoute,
  "space-repo": RepoRoute,
  repo: RepoRoute,
  chat: ChatRoute,
  repos: ReposRoute,
  groups: GroupsRoute,
  storage: StorageRoute,
  apps: AppsRoute,
  deploy: DeployRoute,
  memory: MemoryRoute,
  settings: SettingsRoute,
  "space-settings": SpaceSettingsRoute,
  profile: ProfileRoute,
  "legacy-app-store": LegacyAppStoreRoute,
  "legacy-app-repos": LegacyAppReposRoute,
  "legacy-app-workers": LegacyAppWorkersRoute,
  "legacy-app-resources": LegacyAppResourcesRoute,
  "legacy-app": LegacyAppRoute,
  home: HomeRoute,
};

function renderRouteSchemaGroup(
  schemas: ReadonlyArray<{
    key: string;
    componentKey?: AppRouteComponentKey;
    componentPatterns?: readonly string[];
  }>,
) {
  return schemas.flatMap((schema) => {
    const componentKey = schema.componentKey;
    const componentPatterns = schema.componentPatterns;
    if (!componentKey || !componentPatterns) {
      return [];
    }

    return componentPatterns.map((path) => (
      <Route
        path={path}
        component={ROUTE_COMPONENTS[componentKey]}
      />
    ));
  });
}

export function AppRoutes() {
  return (
    <>
      {renderRouteSchemaGroup(PUBLIC_APP_ROUTE_SCHEMAS)}

      <Route path="/" component={ProtectedRouteLayout}>
        {renderRouteSchemaGroup(PROTECTED_APP_ROUTE_SCHEMAS)}
      </Route>

      {renderRouteSchemaGroup(FALLBACK_APP_ROUTE_SCHEMAS)}
    </>
  );
}
