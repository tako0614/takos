import { createMemo, type JSX, lazy, Match, Show, Switch } from "solid-js";
import { Navigate, Route, useParams } from "@solidjs/router";
import { LoadingScreen } from "./components/common/LoadingScreen.tsx";
import {
  type AppRouteComponentKey,
  FALLBACK_APP_ROUTE_SCHEMAS,
  PROTECTED_APP_ROUTE_SCHEMAS,
  PUBLIC_APP_ROUTE_SCHEMAS,
} from "./app-route-schema.ts";
import { useAuth } from "./hooks/useAuth.tsx";
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
import {
  AuthLoadingGate,
  completeSetup,
  NoSpaceAvailableMessage,
  ProtectedRouteLayout,
  RouteSurface,
  SpaceNotFoundMessage,
  useCanonicalHref,
  useCurrentPath,
  useSpaceRouteGuard,
} from "./app-route-shared.tsx";

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

// ---------------------------------------------------------------------------
// Account / Installations screens (folded from the takosumi dashboard SPA).
//
// These screens self-gate on the account-plane cookie session via their ported
// `<Page>` / `<AuthGuard>` wrapper (distinct from the takos product
// `ProtectedRouteLayout`, which gates on `useAuth()`), and drive navigation with
// `@solidjs/router` `useParams` / `useNavigate` directly rather than the takos
// navigation-context. They are therefore registered as plain `<Route>` elements
// appended in `AppRoutes()` (see `ACCOUNT_PLANE_ROUTES`) that bypass the
// schema/navigation-context system, so no `View` union / `RouteState` change is
// needed. `/sign-in` and `/sign-in/callback` are public; the rest redirect to
// `/sign-in` themselves when there is no account-plane session.
// ---------------------------------------------------------------------------
const AccountHubView = lazy(() =>
  import("@takosumi/dashboard/views/account/AccountHubView.tsx").then((module) => ({
    default: module.AccountHubView,
  }))
);
const AccountProfileView = lazy(() =>
  import("@takosumi/dashboard/views/account/AccountHubView.tsx").then((module) => ({
    default: module.AccountProfileView,
  }))
);
const AccountSessionsView = lazy(() =>
  import("@takosumi/dashboard/views/account/AccountHubView.tsx").then((module) => ({
    default: module.AccountSessionsView,
  }))
);
const InstallationsListView = lazy(() =>
  import("@takosumi/dashboard/views/installations/InstallationsListView.tsx")
);
const InstallationDetailView = lazy(() =>
  import("@takosumi/dashboard/views/installations/InstallationDetailView.tsx")
);
const InstallationDangerView = lazy(() =>
  import("@takosumi/dashboard/views/installations/InstallationDangerView.tsx")
);
const InstallByUrlView = lazy(() =>
  import("@takosumi/dashboard/views/account/AccountMiscViews.tsx").then((module) => ({
    default: module.InstallByUrlView,
  }))
);
const SignInView = lazy(() =>
  import("@takosumi/dashboard/views/account/AccountMiscViews.tsx").then((module) => ({
    default: module.SignInView,
  }))
);
const SignInCallbackView = lazy(() =>
  import("@takosumi/dashboard/views/account/AccountMiscViews.tsx").then((module) => ({
    default: module.SignInCallbackView,
  }))
);
const TakosStartView = lazy(() =>
  import("@takosumi/dashboard/views/account/AccountMiscViews.tsx").then((module) => ({
    default: module.TakosStartView,
  }))
);
const AccountHomeView = lazy(() =>
  import("@takosumi/dashboard/views/account/AccountMiscViews.tsx").then((module) => ({
    default: module.HomeView,
  }))
);
const NotificationsView = lazy(() =>
  import("@takosumi/dashboard/views/account/AccountMiscViews.tsx").then((module) => ({
    default: module.NotificationsView,
  }))
);
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
        <LoginPage
          returnTo={currentPath()}
          onLogin={() => auth.redirectToLogin(currentPath())}
        />
      </Match>
      <Match when={auth.user && !auth.user.setup_completed}>
        <SetupPage onComplete={() => completeSetup(auth)} />
      </Match>
      <Match when={canonicalHref()}>
        {(href) => <Navigate href={href()} />}
      </Match>
    </Switch>
  );
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
        {(href) => <Navigate href={href()} />}
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
              {(spaceId) => (
                <RouteSurface>
                  <StoreManagementPage spaceId={spaceId()} />
                </RouteSurface>
              )}
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
        {(href) => <Navigate href={href()} />}
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
        {(href) => <Navigate href={href()} />}
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
        {(spaceId) => (
          <RouteSurface>
            <ReposPanel
              spaceId={spaceId()}
              onNavigateToRepo={(username: string, repoName: string) =>
                navigation.navigate({ view: "repo", username, repoName })}
            />
          </RouteSurface>
        )}
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
  const deploySpaceId = createMemo(() =>
    navigation.routeSpaceId ?? navigation.selectedSpaceId ??
      navigation.preferredSpaceId
  );
  const guard = useSpaceRouteGuard(() => ({
    view: "deploy",
    spaceId: deploySpaceId() ?? undefined,
    deploySection: currentDeploySection(),
  }), route);

  return (
    <Switch>
      <Match when={guard.canonicalHref()}>
        {(href) => <Navigate href={href()} />}
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
          <Show
            when={deploySpaceId()}
            fallback={<NoSpaceAvailableMessage />}
          >
            {(spaceId) => (
              <DeployPanel
                spaceId={spaceId()}
                spaces={auth.spaces}
                activeSection={currentDeploySection()}
                onSectionChange={(section: DeploySection) => {
                  navigation.navigate({
                    view: "deploy",
                    spaceId: spaceId(),
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
            )}
          </Show>
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
        {(href) => <Navigate href={href()} />}
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
        {(spaceId) => (
          <RouteSurface>
            <StoragePage
              spaceId={spaceId()}
              spaces={auth.spaces}
              initialPath={route().storagePath || "/"}
              initialFilePath={route().filePath}
              onPathChange={(path: string) =>
                navigation.navigate(
                  buildStorageNavigationState(spaceId(), path),
                )}
            />
          </RouteSurface>
        )}
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
        {(href) => <Navigate href={href()} />}
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
        {(spaceId) => (
          <RouteSurface>
            <AppsPage
              spaceId={spaceId()}
              onNavigateToStore={() =>
                navigation.navigate({ view: "store", storeTab: "discover" })}
            />
          </RouteSurface>
        )}
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
        {(href) => <Navigate href={href()} />}
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
        {(spaceId) => (
          <RouteSurface>
            <MemoryPage
              spaceId={spaceId()}
              onBack={navigation.navigateToPreferredChat}
            />
          </RouteSurface>
        )}
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
        {(username) => (
          <RouteSurface>
            <UserProfilePage
              username={username()}
              onBack={navigation.navigateToPreferredChat}
              onNavigateToProfile={(target: string) =>
                navigation.navigate({ view: "profile", username: target })}
              onNavigateToRepo={(target: string, repoName: string) => {
                navigation.navigate({
                  view: "repo",
                  username: target,
                  repoName,
                });
              }}
            />
          </RouteSurface>
        )}
      </Match>
    </Switch>
  );
}

function ShareRoute() {
  const params = useParams<{ token?: string }>();
  return (
    <Switch fallback={<LoadingScreen />}>
      <Match when={params.token}>
        {(token) => (
          <RouteSurface>
            <SharedThreadPage token={token()} />
          </RouteSurface>
        )}
      </Match>
    </Switch>
  );
}

function createLegalRoute(
  page: "terms" | "privacy" | "security" | "tokushoho",
) {
  return function LegalRoute() {
    return (
      <RouteSurface>
        <LegalPage page={page} />
      </RouteSurface>
    );
  };
}

const TermsRoute = createLegalRoute("terms");
const PrivacyRoute = createLegalRoute("privacy");
const SecurityRoute = createLegalRoute("security");
const TokushohoRoute = createLegalRoute("tokushoho");

const ROUTE_COMPONENTS: Record<AppRouteComponentKey, () => JSX.Element> = {
  terms: TermsRoute,
  privacy: PrivacyRoute,
  security: SecurityRoute,
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

/**
 * Account / Installations routes folded from the takosumi dashboard SPA.
 *
 * Registered as plain `<Route>` elements (no schema entry, no
 * `ProtectedRouteLayout`) because each view owns its own account-plane session
 * gate. Patterns mirror the dashboard paths so the dashboard's own deep-links
 * keep working; static segments (`/install`, `/installations`, `/account/...`)
 * out-rank the schema's `/:username/:repoName` and `*rest` fallbacks in the
 * @solidjs/router specificity match.
 */
function AccountPlaneRoutes() {
  return (
    <>
      {/* Public — no session required. */}
      <Route path="/sign-in" component={SignInView} />
      <Route path="/sign-in/callback" component={SignInCallbackView} />

      {/* Self-gated (redirect to /sign-in when no account-plane session). */}
      <Route path="/home" component={AccountHomeView} />
      <Route path="/notifications" component={NotificationsView} />
      <Route path="/account" component={AccountHubView} />
      <Route path="/account/profile" component={AccountProfileView} />
      <Route path="/account/sessions" component={AccountSessionsView} />

      <Route path="/install" component={InstallByUrlView} />
      <Route path="/installations" component={InstallationsListView} />
      <Route path="/installations/:id" component={InstallationDetailView} />
      <Route
        path="/installations/:id/danger"
        component={InstallationDangerView}
      />

      <Route path="/takos/start" component={TakosStartView} />
    </>
  );
}

export function AppRoutes() {
  return (
    <>
      {renderRouteSchemaGroup(PUBLIC_APP_ROUTE_SCHEMAS)}

      <Route path="/" component={ProtectedRouteLayout}>
        {renderRouteSchemaGroup(PROTECTED_APP_ROUTE_SCHEMAS)}
      </Route>

      {AccountPlaneRoutes()}

      {renderRouteSchemaGroup(FALLBACK_APP_ROUTE_SCHEMAS)}
    </>
  );
}
