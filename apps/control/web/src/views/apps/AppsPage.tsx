import { Show } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import { Icons } from "../../lib/Icons.tsx";
import { Button } from "../../components/ui/index.ts";
import { toSafeHref } from "../../lib/safeHref.ts";
import {
  formatAppStatusLabel,
  formatAppTypeLabel,
  getAppIconImageSrc,
  type RegisteredApp,
  useRegisteredApps,
} from "./registered-apps.ts";

export interface AppsPageProps {
  spaceId: string;
  onNavigateToStore?: () => void;
}

export function AppsPage(props: AppsPageProps) {
  const { t } = useI18n();
  const { apps, loading, error } = useRegisteredApps(() => props.spaceId);

  const appsCount = () => apps().length;
  const hasApps = () => appsCount() > 0;
  const loadingState = () => loading() && !hasApps();
  const errorMessage = () => error();

  return (
    <div class="flex h-full flex-col overflow-hidden bg-zinc-50 dark:bg-zinc-900">
      <div class="flex-1 overflow-auto">
        <div class="mx-auto flex min-h-full w-full max-w-6xl flex-col px-5 pb-10 pt-6 sm:px-8">
          <div class="flex flex-col gap-3 pb-8 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0">
              <h1 class="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
                {t("apps")}
              </h1>
              <p class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                <Show
                  when={hasApps()}
                  fallback={t("appsInstalledDescription")}
                >
                  {appsCount()} {t("installed")}
                </Show>
              </p>
            </div>
            <div class="flex shrink-0 flex-wrap items-center gap-2">
              <Show when={props.onNavigateToStore}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={props.onNavigateToStore}
                  leftIcon={<Icons.ShoppingBag class="h-4 w-4" />}
                >
                  {t("browseStore")}
                </Button>
              </Show>
            </div>
          </div>

          <Show when={errorMessage()}>
            <div class="mb-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200">
              <p>{errorMessage()}</p>
            </div>
          </Show>

          <Show when={loadingState()}>
            <div class="pt-3">
              <div class="mb-5 flex items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                <div class="h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent dark:border-zinc-500" />
                <span>{t("loading")}</span>
              </div>
              <div class={LAUNCHER_GRID_CLASS}>
                {SKELETON_ITEMS.map((_, index) => (
                  <div
                    class="flex min-h-[138px] flex-col items-center rounded-lg px-2 py-3"
                    aria-hidden="true"
                    data-index={index}
                  >
                    <div class="h-[72px] w-[72px] animate-pulse rounded-lg bg-white/80 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:ring-zinc-800" />
                    <div class="mt-3 h-3 w-20 animate-pulse rounded-full bg-zinc-200 dark:bg-zinc-800" />
                    <div class="mt-2 h-2 w-14 animate-pulse rounded-full bg-zinc-200/80 dark:bg-zinc-800/80" />
                  </div>
                ))}
              </div>
            </div>
          </Show>

          <Show when={!loadingState() && !errorMessage() && !hasApps()}>
            <div class="mt-4 flex min-h-[340px] flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-white/60 px-6 py-12 text-center dark:border-zinc-800 dark:bg-zinc-900/45">
              <div class="mx-auto flex h-16 w-16 items-center justify-center rounded-lg bg-white text-zinc-500 shadow-sm ring-1 ring-zinc-200 dark:bg-zinc-900 dark:text-zinc-300 dark:ring-zinc-800">
                <Icons.Package class="h-8 w-8" />
              </div>
              <h2 class="mt-5 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
                {t("appsInstalledEmpty")}
              </h2>
              <p class="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
                {t("appsInstalledEmptyDesc")}
              </p>
              {props.onNavigateToStore
                ? (
                  <div class="mt-5">
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={props.onNavigateToStore}
                      leftIcon={<Icons.ShoppingBag class="h-4 w-4" />}
                    >
                      {t("browseStore")}
                    </Button>
                  </div>
                )
                : null}
            </div>
          </Show>

          <Show when={!loadingState() && !errorMessage() && hasApps()}>
            <div class={LAUNCHER_GRID_CLASS}>
              {apps().map((app) => {
                const safeHref = toSafeHref(app.url);
                const iconImageSrc = getAppIconImageSrc(app.icon);
                const textIcon = getTextIcon(app);
                const title = getAppTitle(app);
                const appContent = (
                  <>
                    <div class="relative flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white text-zinc-700 shadow-sm ring-1 ring-zinc-200 transition-transform group-hover:-translate-y-0.5 group-focus-visible:-translate-y-0.5 dark:bg-zinc-900 dark:text-zinc-200 dark:ring-zinc-800">
                      <Show
                        when={iconImageSrc}
                        fallback={
                          <Show
                            when={textIcon}
                            fallback={<Icons.Package class="h-8 w-8" />}
                          >
                            <span class="max-w-full truncate px-2 text-3xl leading-none text-zinc-800 dark:text-zinc-100">
                              {textIcon}
                            </span>
                          </Show>
                        }
                      >
                        <img
                          src={iconImageSrc || undefined}
                          alt=""
                          loading="lazy"
                          class="h-full w-full object-cover"
                        />
                      </Show>
                      <Show when={shouldShowStatusDot(app.service_status)}>
                        <span
                          class={`absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full shadow-sm ring-2 ring-white dark:ring-zinc-900 ${
                            getStatusDotClass(app.service_status)
                          }`}
                        />
                      </Show>
                    </div>

                    <span class="mt-3 flex min-h-10 max-w-full items-start justify-center text-center text-sm font-medium leading-5 text-zinc-700 dark:text-zinc-200">
                      <span
                        class="break-words"
                        style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;"
                      >
                        {app.name}
                      </span>
                    </span>
                  </>
                );

                return (
                  <Show
                    when={safeHref}
                    fallback={
                      <div
                        class={`${LAUNCHER_ITEM_CLASS} cursor-default opacity-75`}
                        title={title}
                        aria-disabled="true"
                      >
                        {appContent}
                      </div>
                    }
                  >
                    <a
                      href={safeHref || undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      class={LAUNCHER_ITEM_CLASS}
                      title={title}
                      aria-label={`${app.name} - ${t("openInNewTab")}`}
                    >
                      {appContent}
                    </a>
                  </Show>
                );
              })}
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

const LAUNCHER_GRID_CLASS =
  "grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-x-3 gap-y-7 sm:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] sm:gap-x-6 sm:gap-y-8";

const LAUNCHER_ITEM_CLASS =
  "group relative flex min-h-[124px] flex-col items-center rounded-lg px-2 py-3 text-center transition hover:bg-white/70 focus-visible:bg-white/80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:hover:bg-zinc-900/70 dark:focus-visible:bg-zinc-900/80 dark:focus-visible:outline-zinc-100";

const SKELETON_ITEMS = Array.from({ length: 12 });

function getStatusDotClass(status: string | null | undefined): string {
  const normalized = status?.toLowerCase();
  if (!normalized) return "bg-zinc-400";
  if (normalized === "deployed" || normalized === "active") {
    return "bg-emerald-500";
  }
  if (
    normalized === "failed" || normalized === "error" ||
    normalized === "degraded"
  ) {
    return "bg-red-500";
  }
  if (
    normalized.includes("pending") || normalized.includes("queue") ||
    normalized.includes("progress") || normalized === "paused"
  ) {
    return "bg-amber-400";
  }
  return "bg-sky-500";
}

function shouldShowStatusDot(status: string | null | undefined): boolean {
  const normalized = status?.toLowerCase();
  return normalized !== "deployed" && normalized !== "active";
}

function getTextIcon(app: RegisteredApp): string | null {
  const icon = app.icon?.trim();
  if (!icon || getAppIconImageSrc(icon)) return null;

  const chars = Array.from(icon);
  if (chars.length <= 3) return icon;

  return Array.from(app.name.trim())[0]?.toUpperCase() ?? null;
}

function getAppTitle(app: RegisteredApp): string {
  return [
    app.name,
    app.description,
    app.category,
    formatAppTypeLabel(app.app_type),
    formatAppStatusLabel(app.service_status),
    app.space_name,
    app.service_hostname,
  ].filter(Boolean).join(" / ");
}
