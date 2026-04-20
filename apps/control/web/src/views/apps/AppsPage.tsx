import { Show } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { Icons } from "../../lib/Icons.tsx";
import { Badge, Button } from "../../components/ui/index.ts";
import { toSafeHref } from "../../lib/safeHref.ts";
import {
  formatAppStatusLabel,
  formatAppTypeLabel,
  getAppStatusVariant,
  useRegisteredApps,
} from "./registered-apps.ts";

export interface AppsPageProps {
  spaceId: string;
  onNavigateToStore?: () => void;
}

export function AppsPage({ spaceId, onNavigateToStore }: AppsPageProps) {
  const { t } = useI18n();
  const { apps, loading, error, fetchApps } = useRegisteredApps(() => spaceId);

  const appsCount = () => apps().length;
  const hasApps = () => appsCount() > 0;
  const loadingState = () => loading() && !hasApps();
  const errorMessage = () => error();

  return (
    <div class="flex h-full flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-900">
      <div class="flex-1 overflow-auto">
        <div class="mx-auto w-full max-w-6xl px-4 pb-10 pt-8">
          <div class="flex items-start justify-between gap-4 pb-6">
            <div class="min-w-0">
              <h1 class="text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                {t("apps")}
              </h1>
              <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {t("appsInstalledDescription")}
              </p>
            </div>
            <Show when={hasApps()}>
              <Badge size="md" variant="info" class="shrink-0">
                {appsCount()}
              </Badge>
            </Show>
          </div>

          <Show when={errorMessage()}>
            <div class="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              <div class="flex items-start justify-between gap-3">
                <p>{errorMessage()}</p>
                <Button variant="secondary" size="sm" onClick={fetchApps}>
                  {t("refresh")}
                </Button>
              </div>
            </div>
          </Show>

          <Show when={loadingState()}>
            <div class="rounded-lg border border-zinc-200 bg-white px-6 py-10 text-center dark:border-zinc-800 dark:bg-zinc-950">
              <div class="mx-auto mb-3 h-6 w-6 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent dark:border-zinc-500" />
              <p class="text-sm text-zinc-500 dark:text-zinc-400">
                {t("loading")}
              </p>
            </div>
          </Show>

          <Show when={!loadingState() && !errorMessage() && !hasApps()}>
            <div class="mt-6 rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
              <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-300">
                <Icons.Package class="h-8 w-8" />
              </div>
              <h2 class="mt-5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {t("appsInstalledEmpty")}
              </h2>
              <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                {t("appsInstalledEmptyDesc")}
              </p>
              {onNavigateToStore
                ? (
                  <div class="mt-5">
                    <button
                      type="button"
                      onClick={onNavigateToStore}
                      class="inline-flex items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                    >
                      <Icons.ShoppingBag class="h-4 w-4" />
                      {t("browseStore")}
                    </button>
                  </div>
                )
                : null}
            </div>
          </Show>

          <Show when={!loadingState() && !errorMessage() && hasApps()}>
            <div class="grid gap-3">
              {apps().map((app) => {
                const safeHref = toSafeHref(app.url);
                return (
                  <article class="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
                    <div class="flex items-start gap-4">
                      <div class="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-2xl text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100">
                        {app.icon || <Icons.Package class="h-6 w-6" />}
                      </div>

                      <div class="min-w-0 flex-1">
                        <div class="flex flex-wrap items-center gap-2">
                          <h2 class="min-w-0 truncate text-base font-semibold text-zinc-900 dark:text-zinc-50">
                            {app.name}
                          </h2>
                          <Badge size="sm">{t("installed")}</Badge>
                          <Badge size="sm" variant="info">
                            {formatAppTypeLabel(app.app_type)}
                          </Badge>
                          <Badge
                            size="sm"
                            variant={getAppStatusVariant(app.service_status)}
                          >
                            {formatAppStatusLabel(app.service_status)}
                          </Badge>
                        </div>

                        <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                          {app.description || t("noDescription")}
                        </p>

                        <div class="mt-4 flex flex-wrap gap-x-4 gap-y-2 text-sm text-zinc-500 dark:text-zinc-400">
                          <Show when={app.space_name}>
                            <span class="inline-flex min-w-0 items-center gap-1.5">
                              <Icons.Users class="h-4 w-4 shrink-0" />
                              <span class="truncate">{app.space_name}</span>
                            </span>
                          </Show>
                          <Show when={app.service_hostname}>
                            <span class="inline-flex min-w-0 items-center gap-1.5">
                              <Icons.Server class="h-4 w-4 shrink-0" />
                              <span class="truncate">
                                {app.service_hostname}
                              </span>
                            </span>
                          </Show>
                          <Show when={app.url}>
                            <span class="inline-flex min-w-0 items-center gap-1.5">
                              <Icons.Globe class="h-4 w-4 shrink-0" />
                              <span class="truncate">{app.url}</span>
                            </span>
                          </Show>
                        </div>
                      </div>

                      <div class="flex shrink-0 flex-col gap-2">
                        <Show when={safeHref}>
                          <a
                            href={safeHref || undefined}
                            target="_blank"
                            rel="noopener noreferrer"
                            class="inline-flex items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800"
                          >
                            <Icons.ExternalLink class="h-4 w-4" />
                            {t("openInNewTab")}
                          </a>
                        </Show>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}
