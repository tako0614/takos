import { createMemo, type JSX, lazy, Match, Show, Switch } from "solid-js";
import { Navigate, Route, useLocation, useParams } from "@solidjs/router";
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
  })),
);
const RepoDetailPage = lazy(() =>
  import("./views/repos/RepoDetailPage.tsx").then((module) => ({
    default: module.RepoDetailPage,
  })),
);
const ChatPage = lazy(() =>
  import("./views/chat/ChatPage.tsx").then((module) => ({
    default: module.ChatPage,
  })),
);
const AppsPage = lazy(() =>
  import("./views/apps/AppsPage.tsx").then((module) => ({
    default: module.AppsPage,
  })),
);
const ReposPanel = lazy(() =>
  import("./views/repos/ReposPanel.tsx").then((module) => ({
    default: module.ReposPanel,
  })),
);
const DeployPanel = lazy(() =>
  import("./views/app/space/DeployPanel.tsx").then((module) => ({
    default: module.DeployPanel,
  })),
);
const StoragePage = lazy(() =>
  import("./views/storage/StoragePage.tsx").then((module) => ({
    default: module.StoragePage,
  })),
);
const SpaceSettingsPage = lazy(() =>
  import("./views/hub/SpaceSettingsPage.tsx").then((module) => ({
    default: module.SpaceSettingsPage,
  })),
);
const SettingsView = lazy(() =>
  import("./views/app/SettingsView.tsx").then((module) => ({
    default: module.SettingsView,
  })),
);
const MemoryPage = lazy(() =>
  import("./views/MemoryPage.tsx").then((module) => ({
    default: module.MemoryPage,
  })),
);
const LegalPage = lazy(() =>
  import("./views/legal/LegalPage.tsx").then((module) => ({
    default: module.LegalPage,
  })),
);
const SharedThreadPage = lazy(() =>
  import("./views/share/SharedThreadPage.tsx").then((module) => ({
    default: module.SharedThreadPage,
  })),
);

// ---------------------------------------------------------------------------
// Admin screens folded from the takosumi dashboard SPA (the app-centric
// rebuild: app list / app detail / add flow / run screen / space settings).
//
// These screens self-gate on the account-plane cookie session via their ported
// `<Page>` / `<AuthGuard>` wrapper (distinct from the takos product
// `ProtectedRouteLayout`, which gates on `useAuth()`), and drive navigation
// with `@solidjs/router` directly rather than the takos navigation-context.
// They are registered as plain `<Route>` elements appended in `AppRoutes()`
// (see `AccountPlaneRoutes`) that bypass the schema/navigation-context system.
// Their static segments out-rank the schema's `/:username/:repoName` and
// `*rest` fallbacks in the @solidjs/router specificity match.
//
// One deliberate divergence from the takosumi platform worker: "/" belongs to
// the takos PRODUCT here, so the admin app list lives at `/installations`
// (and links inside the embedded shell that point at "/" land on the product
// home — which is the right "home" for a takos deployment).
// ---------------------------------------------------------------------------
const AccountView = lazy(
  () => import("@takosumi/dashboard/views/account/AccountView.tsx"),
);
const AppListView = lazy(
  () => import("@takosumi/dashboard/views/apps/AppListView.tsx"),
);
const AppDetailView = lazy(
  () => import("@takosumi/dashboard/views/apps/AppDetailView.tsx"),
);
const NewAppView = lazy(
  () => import("@takosumi/dashboard/views/new/NewAppView.tsx"),
);
const RunView = lazy(
  () => import("@takosumi/dashboard/views/runs/RunView.tsx"),
);
const RunGroupView = lazy(
  () => import("@takosumi/dashboard/views/runs/RunGroupView.tsx"),
);
const GraphView = lazy(
  () => import("@takosumi/dashboard/views/graph/GraphView.tsx"),
);
const ActivityView = lazy(
  () => import("@takosumi/dashboard/views/activity/ActivityView.tsx"),
);
const SpaceSettingsView = lazy(
  () => import("@takosumi/dashboard/views/space/SpaceSettingsView.tsx"),
);
const SignInView = lazy(
  () => import("@takosumi/dashboard/views/auth/SignInView.tsx"),
);
const SignInCallbackView = lazy(() =>
  import("@takosumi/dashboard/views/auth/SignInView.tsx").then((module) => ({
    default: module.SignInCallbackView,
  })),
);
const NotificationsView = lazy(
  () => import("@takosumi/dashboard/views/notifications/NotificationsView.tsx"),
);
function HomeRoute() {
  const auth = useAuth();
  const navigation = useNavigation();
  const currentPath = useCurrentPath();
  const targetRoute = createMemo<RouteState | null>(() => {
    if (
      auth.authState !== "authenticated" ||
      !auth.user ||
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
      <Match when={currentPath() !== "/"}>
        <NotFoundPage />
      </Match>
      <Match when={canonicalHref()}>
        {(href) => <Navigate href={href()} />}
      </Match>
    </Switch>
  );
}

function NotFoundPage() {
  const { t } = useI18n();
  return (
    <div class="flex flex-col items-center justify-center h-full gap-3 text-center px-6">
      <p class="text-4xl font-semibold text-[var(--color-text-primary)]">404</p>
      <p class="text-sm text-[var(--color-text-secondary)]">
        {t("notFoundMessage")}
      </p>
      <a
        href="/"
        class="text-sm text-[var(--color-primary)] underline underline-offset-2"
      >
        {t("backToHome")}
      </a>
    </div>
  );
}

function StoreRoute() {
  const auth = useAuth();
  const currentPath = useCurrentPath();

  return (
    <Switch
      fallback={
        <RouteSurface>
          <SourcePage
            spaces={[]}
            isAuthenticated={false}
            onRequireLogin={() => auth.redirectToLogin(currentPath())}
          />
        </RouteSurface>
      }
    >
      <Match when={auth.authState === "loading"}>
        <AuthLoadingGate />
      </Match>
      <Match when={auth.authState === "authenticated"}>
        <AuthenticatedLayout>
          <RouteSurface>
            <SourcePage
              spaces={auth.spaces}
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
  const guard = useSpaceRouteGuard(() => null, route);
  const backSpace = createMemo(() =>
    navigation.routeSpaceId
      ? findSpaceByIdentifier(
          auth.spaces,
          navigation.routeSpaceId,
          t("personal"),
        )
      : navigation.preferredSpace,
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
            initialFilePath={route().filePath}
            initialFileLine={route().fileLine}
            initialRef={route().ref}
            onBack={() => navigation.navigate({ view: "store" })}
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
        when={
          auth.authState === "authenticated" && guard.hasInvalidSpaceRoute()
        }
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
              const spaceId =
                navigation.routeSpaceId ??
                navigation.selectedSpaceId ??
                navigation.preferredSpaceId;
              if (spaceId) {
                navigation.navigateToChat(spaceId, threadId);
              }
            }}
            onUpdateThread={(threadId: string, updates: Partial<Thread>) => {
              navigation.setThreadsBySpace((previous) => {
                const next: Record<string, Thread[]> = {};
                for (const key of Object.keys(previous)) {
                  next[key] = previous[key].map((thread) =>
                    thread.id === threadId ? { ...thread, ...updates } : thread,
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
  const resolvedSpaceId = createMemo(
    () => navigation.routeSpaceId ?? navigation.preferredSpaceId,
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
              onNavigateToRepo={(navSpaceId: string, repoId: string) =>
                navigation.navigate({
                  view: "repo",
                  spaceId: navSpaceId,
                  repoId,
                })
              }
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
  const currentDeploySection = createMemo(
    () => navigation.route.deploySection || "workers",
  );
  const deploySpaceId = createMemo(
    () =>
      navigation.routeSpaceId ??
      navigation.selectedSpaceId ??
      navigation.preferredSpaceId,
  );
  const guard = useSpaceRouteGuard(
    () => ({
      view: "deploy",
      spaceId: deploySpaceId() ?? undefined,
      deploySection: currentDeploySection(),
    }),
    route,
  );

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
          <Show when={deploySpaceId()} fallback={<NoSpaceAvailableMessage />}>
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
                  auth.setUserSettings(settings)
                }
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
  const storageSpaceId = createMemo(
    () => navigation.routeSpaceId ?? navigation.preferredSpaceId,
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
                )
              }
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
  const appsSpaceId = createMemo(
    () => navigation.routeSpaceId ?? navigation.preferredSpaceId,
  );
  const guard = useSpaceRouteGuard(
    () => ({
      view: "apps",
      spaceId: appsSpaceId() ?? undefined,
    }),
    route,
  );

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
              onNavigateToStore={() => navigation.navigate({ view: "store" })}
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
  const selectedSpaceId = createMemo(
    () => navigation.routeSpaceId ?? navigation.selectedSpaceId ?? null,
  );
  const guard = useSpaceRouteGuard(
    () => ({
      view: "space-settings",
      spaceId: selectedSpaceId() ?? undefined,
    }),
    route,
  );

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
          auth.setUserSettings(settings)
        }
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
      <Route path={path} component={ROUTE_COMPONENTS[componentKey]} />
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
/** Redirect preserving the query string (the external install link's
 * `/install?git=…` prefill and the Cloudflare OAuth callback's
 * `/connections?connected=1` both carry load-bearing params). */
function RedirectWithQuery(props: { readonly to: string }) {
  const loc = useLocation();
  return <Navigate href={`${props.to}${loc.search}`} />;
}

function AccountPlaneRoutes() {
  return (
    <>
      {/* Public — no session required. */}
      <Route path="/sign-in" component={SignInView} />
      <Route path="/sign-in/callback" component={SignInCallbackView} />

      {/* Self-gated (redirect to /sign-in when no account-plane session). */}
      <Route path="/notifications" component={NotificationsView} />
      <Route path="/account" component={AccountView} />
      <Route path="/new" component={NewAppView} />
      <Route path="/installations" component={AppListView} />
      <Route path="/installations/:id" component={AppDetailView} />
      <Route path="/installations/:id/:tab" component={AppDetailView} />
      <Route path="/runs/:id" component={RunView} />
      <Route path="/run-groups/:id" component={RunGroupView} />
      <Route path="/graph" component={GraphView} />
      <Route path="/activity" component={ActivityView} />
      <Route path="/space/settings" component={SpaceSettingsView} />
      <Route path="/space/settings/:tab" component={SpaceSettingsView} />

      {/* /install is the external install link (client-handled): forwards its
          query to /new, where the dashboard's install-link parser seeds the
          Git form — pre-fill only, the visitor always confirms. */}
      <Route
        path="/install"
        component={() => <RedirectWithQuery to="/new" />}
      />
      <Route
        path="/connections"
        component={() => <RedirectWithQuery to="/space/settings/connections" />}
      />
      <Route
        path="/account/profile"
        component={() => <Navigate href="/account" />}
      />
      <Route
        path="/account/sessions"
        component={() => <Navigate href="/account" />}
      />
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
