import { createMemo, type JSX, Match, Suspense, Switch } from "solid-js";
import { useLocation } from "@solidjs/router";
import { LoadingScreen } from "./components/common/LoadingScreen.tsx";
import { Button } from "./components/ui/Button.tsx";
import { ErrorBoundary } from "./components/ui/ErrorBoundary.tsx";
import { useAuth } from "./hooks/useAuth.tsx";
import { buildPath } from "./hooks/router-state.ts";
import { rpc } from "./lib/rpc.ts";
import { useNavigation } from "./store/navigation.ts";
import { useModals } from "./store/modal.tsx";
import { useDocumentTitle } from "./hooks/useDocumentTitle.ts";
import { useI18n } from "./store/i18n.ts";
import type { RouteState } from "./types/index.ts";
import { SetupPage } from "./views/SetupPage.tsx";
import { LoginPage } from "./views/app/AuthViews.tsx";
import { AuthenticatedLayout } from "./components/layout/AuthenticatedLayout.tsx";

export function BootstrapErrorScreen(props: {
  title: string;
  message: string;
  retryLabel: string;
  loginLabel: string;
  onRetry: () => void;
  onLogin: () => void;
}) {
  useDocumentTitle(() => props.title);
  return (
    <main class="min-h-screen bg-white dark:bg-zinc-900 flex items-center justify-center px-6">
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
    </main>
  );
}

export function RouteSurface(props: { children: JSX.Element }) {
  return (
    <ErrorBoundary>
      <Suspense fallback={<LoadingScreen />}>
        {props.children}
      </Suspense>
    </ErrorBoundary>
  );
}

export function SurfaceMessage(
  props: { title: string; description?: string; action?: JSX.Element },
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
        {props.action ? <div class="pt-3">{props.action}</div> : null}
      </div>
    </div>
  );
}

export function useCurrentPath() {
  const location = useLocation();
  return createMemo(() => `${location.pathname}${location.search}`);
}

export function useCanonicalHref(nextRoute: () => RouteState | null) {
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

export async function completeSetup(auth: ReturnType<typeof useAuth>) {
  try {
    await rpc.me.settings.$patch({
      json: { setup_completed: true, auto_update_enabled: true },
    });
  } catch {
    // ignored
  }
  await auth.fetchUser();
}

export function AuthLoadingGate() {
  const auth = useAuth();
  const { t } = useI18n();
  const currentPath = useCurrentPath();

  return (
    <Switch fallback={<LoadingScreen />}>
      <Match when={auth.bootstrapError}>
        {(message) => (
          <BootstrapErrorScreen
            title={t("failedToLoad")}
            message={message()}
            retryLabel={t("refresh")}
            loginLabel={t("continueWithTakosumiAccounts")}
            onRetry={() => {
              void auth.fetchUser();
            }}
            onLogin={() => auth.redirectToLogin(currentPath())}
          />
        )}
      </Match>
    </Switch>
  );
}

export function ProtectedRouteLayout(props: { children?: JSX.Element }) {
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
        <LoginPage
          returnTo={currentPath()}
          onLogin={() => auth.redirectToLogin(currentPath())}
        />
      </Match>
      <Match when={auth.user && !auth.user.setup_completed}>
        <SetupPage onComplete={() => completeSetup(auth)} />
      </Match>
    </Switch>
  );
}

export function SpaceNotFoundMessage() {
  const { t } = useI18n();
  const navigation = useNavigation();
  useDocumentTitle(() => t("spaceNotFound"));
  return (
    <SurfaceMessage
      title={t("spaceNotFound")}
      description={t("spaceNotFoundDesc")}
      action={
        <Button
          variant="secondary"
          onClick={() => navigation.navigateToPreferredChat()}
        >
          {t("backToHome")}
        </Button>
      }
    />
  );
}

export function NoSpaceAvailableMessage() {
  const { t } = useI18n();
  const modal = useModals();
  useDocumentTitle(() => t("noSpaceAvailable"));

  return (
    <SurfaceMessage
      title={t("noSpaceAvailable")}
      action={
        <Button onClick={() => modal.setShowCreateSpace(true)}>
          {t("createSpace")}
        </Button>
      }
    />
  );
}

export function useSpaceRouteGuard(
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
