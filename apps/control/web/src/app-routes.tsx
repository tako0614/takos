import {
  type Component,
  createEffect,
  createMemo,
  type JSX,
  lazy,
  Suspense,
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

const SourcePage = lazyNamed(
  () => import("./views/source/SourcePage.tsx"),
  "SourcePage",
);
const RepoDetailPage = lazyNamed(
  () => import("./views/repos/RepoDetailPage.tsx"),
  "RepoDetailPage",
);
const ChatPage = lazyNamed(
  () => import("./views/chat/ChatPage.tsx"),
  "ChatPage",
);
const AppsPage = lazyNamed(
  () => import("./views/apps/AppsPage.tsx"),
  "AppsPage",
);
const ReposPanel = lazyNamed(
  () => import("./views/repos/ReposPanel.tsx"),
  "ReposPanel",
);
const DeployPanel = lazyNamed(
  () => import("./views/app/space/DeployPanel.tsx"),
  "DeployPanel",
);
const StoragePage = lazyNamed(
  () => import("./views/storage/StoragePage.tsx"),
  "StoragePage",
);
const StoreManagementPage = lazyNamed(
  () => import("./views/store/StoreManagementPage.tsx"),
  "StoreManagementPage",
);
const SpaceSettingsPage = lazyNamed(
  () => import("./views/hub/SpaceSettingsPage.tsx"),
  "SpaceSettingsPage",
);
const SettingsView = lazyNamed(
  () => import("./views/app/SettingsView.tsx"),
  "SettingsView",
);
const MemoryPage = lazyNamed(
  () => import("./views/MemoryPage.tsx"),
  "MemoryPage",
);
const UserProfilePage = lazyNamed(
  () => import("./views/profile/UserProfilePage.tsx"),
  "UserProfilePage",
);
const LegalPage = lazyNamed(
  () => import("./views/legal/LegalPage.tsx"),
  "LegalPage",
);
const SharedThreadPage = lazyNamed(
  () => import("./views/share/SharedThreadPage.tsx"),
  "SharedThreadPage",
);
const OAuthConsentView = lazyNamed(
  () => import("./views/oauth/OAuthConsentView.tsx"),
  "OAuthConsentView",
);
const DeviceAuthView = lazyNamed(
  () => import("./views/oauth/DeviceAuthView.tsx"),
  "DeviceAuthView",
);

function lazyNamed<
  TModule extends Record<string, unknown>,
  TKey extends keyof TModule & string,
>(loader: () => Promise<TModule>, key: TKey) {
  return lazy(async () => {
    const module = await loader();
    return { default: module[key] as Component<any> };
  });
}

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

  if (auth.bootstrapError) {
    return (
      <BootstrapErrorScreen
        title={t("failedToLoad")}
        message={auth.bootstrapError}
        retryLabel={t("refresh")}
        loginLabel={t("continueWithGoogle")}
        onRetry={() => {
          void auth.fetchUser();
        }}
        onLogin={() => auth.redirectToLogin(currentPath())}
      />
    );
  }

  return <LoadingScreen />;
}

function ProtectedRouteLayout(props: { children?: JSX.Element }) {
  const auth = useAuth();
  const currentPath = useCurrentPath();

  if (auth.authState === "loading") {
    return <AuthLoadingGate />;
  }

  if (auth.authState === "login") {
    return <LoginPage onLogin={() => auth.redirectToLogin(currentPath())} />;
  }

  if (auth.user && !auth.user.setup_completed) {
    return <SetupPage onComplete={() => completeSetup(auth)} />;
  }

  return <AuthenticatedLayout>{props.children}</AuthenticatedLayout>;
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

  if (auth.authState === "loading") {
    return <AuthLoadingGate />;
  }

  if (auth.authState === "login") {
    return <LoginPage onLogin={() => auth.redirectToLogin(currentPath())} />;
  }

  if (auth.user && !auth.user.setup_completed) {
    return <SetupPage onComplete={() => completeSetup(auth)} />;
  }

  return canonicalHref()
    ? <Navigate href={canonicalHref()!} />
    : <LoadingScreen />;
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
  return (
    <div class="flex-1 flex items-center justify-center">
      <p class="text-zinc-500">No space available</p>
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

  if (canonicalHref()) {
    return <Navigate href={canonicalHref()!} />;
  }

  if (auth.authState === "loading") {
    return <AuthLoadingGate />;
  }

  if (auth.authState === "authenticated") {
    if (storeTab() === "installed") {
      const storeSpaceId = navigation.routeSpaceId ??
        navigation.preferredSpaceId;
      if (!storeSpaceId) {
        return <LoadingScreen />;
      }
      return (
        <AuthenticatedLayout>
          <RouteSurface>
            <StoreManagementPage spaceId={storeSpaceId} />
          </RouteSurface>
        </AuthenticatedLayout>
      );
    }

    return (
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
    );
  }

  return (
    <RouteSurface>
      <SourcePage
        spaces={[]}
        onNavigateToRepo={(username: string, repoName: string) =>
          navigation.navigate({ view: "repo", username, repoName })}
        isAuthenticated={false}
        onRequireLogin={() => auth.redirectToLogin(currentPath())}
      />
    </RouteSurface>
  );
}

function RepoRoute() {
  const auth = useAuth();
  const navigation = useNavigation();
  const { t } = useI18n();
  const currentPath = useCurrentPath();
  const route = createMemo(() => navigation.route);

  if (auth.authState === "loading") {
    return <AuthLoadingGate />;
  }

  if (auth.authState === "authenticated") {
    const hasInvalidSpaceRoute = Boolean(navigation.route.spaceId) &&
      !navigation.routeSpaceId &&
      auth.spacesLoaded;

    if (hasInvalidSpaceRoute) {
      return (
        <AuthenticatedLayout>
          <SpaceNotFoundMessage />
        </AuthenticatedLayout>
      );
    }

    const backSpace = navigation.routeSpaceId
      ? findSpaceByIdentifier(
        auth.spaces,
        navigation.routeSpaceId,
        t("personal"),
      )
      : navigation.preferredSpace;
    const backSpaceId = backSpace ? getSpaceIdentifier(backSpace) : undefined;

    return (
      <AuthenticatedLayout>
        <RouteSurface>
          <RepoDetailPage
            spaceId={backSpaceId}
            repoId={route().repoId}
            username={route().username}
            repoName={route().repoName}
            initialFilePath={route().filePath}
            initialFileLine={route().fileLine}
            initialRef={route().ref}
            onBack={() => {
              navigation.navigateToChat(backSpaceId);
            }}
            isAuthenticated
            onRequireLogin={() => auth.redirectToLogin(currentPath())}
          />
        </RouteSurface>
      </AuthenticatedLayout>
    );
  }

  return (
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

  if (guard.canonicalHref()) {
    return <Navigate href={guard.canonicalHref()!} />;
  }

  if (guard.isPending()) {
    return <LoadingScreen />;
  }

  if (guard.hasInvalidSpaceRoute()) {
    return <SpaceNotFoundMessage />;
  }

  return (
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
          if (navigation.routeSpaceId) {
            navigation.navigateToChat(navigation.routeSpaceId, threadId);
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

  if (guard.canonicalHref()) {
    return <Navigate href={guard.canonicalHref()!} />;
  }

  if (guard.isPending()) {
    return <LoadingScreen />;
  }

  if (guard.hasInvalidSpaceRoute()) {
    return <SpaceNotFoundMessage />;
  }

  if (!resolvedSpaceId() && !auth.spacesLoaded) {
    return <LoadingScreen />;
  }

  if (!resolvedSpaceId()) {
    return <LoadingScreen />;
  }

  return (
    <RouteSurface>
      <ReposPanel
        spaceId={resolvedSpaceId()!}
        onNavigateToRepo={(username: string, repoName: string) =>
          navigation.navigate({ view: "repo", username, repoName })}
      />
    </RouteSurface>
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
  const deploySpaceId = createMemo(() =>
    navigation.routeSpaceId ?? navigation.selectedSpaceId ??
      navigation.preferredSpaceId
  );
  const guard = useSpaceRouteGuard(() => ({
    view: "deploy",
    spaceId: deploySpaceId() ?? undefined,
    deploySection: currentDeploySection(),
  }), route);

  if (guard.canonicalHref()) {
    return <Navigate href={guard.canonicalHref()!} />;
  }

  if (guard.isPending()) {
    return <LoadingScreen />;
  }

  if (guard.hasInvalidSpaceRoute()) {
    return <SpaceNotFoundMessage />;
  }

  if (!deploySpaceId() && !auth.spacesLoaded) {
    return <LoadingScreen />;
  }

  return (
    <RouteSurface>
      {deploySpaceId()
        ? (
          <DeployPanel
            spaceId={deploySpaceId()!}
            spaces={auth.spaces}
            activeSection={currentDeploySection()}
            onSectionChange={(section: DeploySection) => {
              navigation.navigate({
                view: "deploy",
                spaceId: deploySpaceId() ?? undefined,
                deploySection: section,
              });
            }}
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

  if (guard.canonicalHref()) {
    return <Navigate href={guard.canonicalHref()!} />;
  }

  if (guard.isPending()) {
    return <LoadingScreen />;
  }

  if (guard.hasInvalidSpaceRoute()) {
    return <SpaceNotFoundMessage />;
  }

  if (!storageSpaceId() && !auth.spacesLoaded) {
    return <LoadingScreen />;
  }

  if (!storageSpaceId()) {
    return <LoadingScreen />;
  }

  return (
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

  if (guard.canonicalHref()) {
    return <Navigate href={guard.canonicalHref()!} />;
  }

  if (guard.isPending()) {
    return <LoadingScreen />;
  }

  if (guard.hasInvalidSpaceRoute()) {
    return <SpaceNotFoundMessage />;
  }

  if (!appsSpaceId()) {
    if (!auth.spacesLoaded) {
      return <LoadingScreen />;
    }
    return <NoSpaceAvailableMessage />;
  }

  return (
    <RouteSurface>
      <AppsPage
        onNavigateToStore={() =>
          navigation.navigate({ view: "store", storeTab: "discover" })}
      />
    </RouteSurface>
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

  if (guard.canonicalHref()) {
    return <Navigate href={guard.canonicalHref()!} />;
  }

  if (guard.isPending()) {
    return <LoadingScreen />;
  }

  if (guard.hasInvalidSpaceRoute()) {
    return <SpaceNotFoundMessage />;
  }

  return (
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
  const navigation = useNavigation();

  if (!navigation.preferredSpace) {
    return <LoadingScreen />;
  }

  return (
    <RouteSurface>
      <MemoryPage
        spaceId={getSpaceIdentifier(navigation.preferredSpace)}
        onBack={navigation.navigateToPreferredChat}
      />
    </RouteSurface>
  );
}

function ProfileRoute() {
  const navigation = useNavigation();
  const route = createMemo(() => navigation.route);

  if (!route().username) {
    return <LoadingScreen />;
  }

  return (
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
  );
}

function LegacyAppShortcutRoute(props: { target: () => RouteState }) {
  const canonicalHref = useCanonicalHref(props.target);
  return canonicalHref()
    ? <Navigate href={canonicalHref()!} />
    : <LoadingScreen />;
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

  const resolution = resolver.resolution();
  if (resolution?.externalHref) {
    return <ExternalRedirect href={resolution.externalHref} />;
  }
  if (resolution?.targetRoute) {
    return <Navigate href={buildPath(resolution.targetRoute)} />;
  }
  if (resolver.resolving()) {
    return <LoadingScreen />;
  }
  return <LoadingScreen />;
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
  if (!params.token) {
    return <LoadingScreen />;
  }
  return (
    <RouteSurface>
      <SharedThreadPage token={params.token} />
    </RouteSurface>
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

const ROUTE_COMPONENTS: Record<AppRouteComponentKey, Component<any>> = {
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
