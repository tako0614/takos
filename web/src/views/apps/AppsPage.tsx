import { createMemo, For, Show } from "solid-js";
import { type TranslationKey, useI18n } from "../../store/i18n.ts";
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
import {
  type CapsuleInstallation,
  type CapsuleServiceSummary,
  isInflightInstallation,
  useCapsuleInstallations,
} from "./inflight-installs.ts";

export interface AppsPageProps {
  spaceId: string;
  onNavigateToStore?: () => void;
}

const INFLIGHT_STATUS_LABEL: Record<string, TranslationKey> = {
  pending: "installStatusPending",
  installing: "installStatusInstalling",
  stale: "installStatusStale",
  error: "installStatusError",
  failed: "installStatusFailed",
};

export function AppsPage(props: AppsPageProps) {
  const i18n = useI18n();
  const t = i18n.t;
  const { apps, loading, error } = useRegisteredApps(() => props.spaceId);
  // Takosumi Capsule projections are the install/deployment truth. This stays
  // fail-soft so a workspace without Accounts config keeps the plain launcher.
  const { installations } = useCapsuleInstallations(() => props.spaceId);
  const inflightInstalls = createMemo(() =>
    installations().filter(isInflightInstallation),
  );
  const workspaceCapsules = createMemo(() =>
    installations().filter(
      (installation) =>
        installation.services.length > 0 ||
        !isInflightInstallation(installation),
    ),
  );

  const appsCount = () => apps().length;
  const hasApps = () => appsCount() > 0;
  const capsulesCount = () => workspaceCapsules().length;
  const hasCapsules = () => capsulesCount() > 0;
  const loadingState = () => loading() && !hasApps();
  const errorMessage = () => error();

  const inflightStatusLabel = (status: string) => {
    const key = INFLIGHT_STATUS_LABEL[status];
    return key ? t(key) : status;
  };
  const inflightStatusClass = (status: string) =>
    status === "error"
      ? "text-red-600 dark:text-red-400 font-medium"
      : "text-zinc-500 dark:text-zinc-400";

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
                  when={hasApps() || hasCapsules()}
                  fallback={t("appsInstalledDescription")}
                >
                  {appsCount()} {t("installed")}
                  <Show when={hasCapsules()}>
                    {" · "}
                    {t("appsCapsulesCount", {
                      count: capsulesCount(),
                    })}
                  </Show>
                </Show>
              </p>
            </div>
            <div class="flex shrink-0 flex-wrap items-center gap-2">
              <Show when={props.onNavigateToStore}>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={props.onNavigateToStore}
                  leftIcon={<Icons.Download class="h-4 w-4" />}
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

          {/* In-flight installs from the Takosumi Capsule flow. Lets this page answer
              "what did I just add?" while keeping launcher routes separate
              from installation detail routes. */}
          <Show when={inflightInstalls().length > 0}>
            <div class="mb-6 rounded-lg border border-amber-200 bg-amber-50/70 px-4 py-3 dark:border-amber-900/40 dark:bg-amber-950/20">
              <div class="mb-2 flex items-center justify-between">
                <h2 class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {t("appsInflightTitle")}
                </h2>
              </div>
              <ul class="flex flex-col gap-1">
                <For each={inflightInstalls()}>
                  {(inst) => (
                    <li>
                      <div class="flex items-center justify-between rounded px-2 py-1.5 text-sm text-zinc-700 dark:text-zinc-200">
                        <span class="truncate font-medium">{inst.name}</span>
                        <span
                          class={`ml-3 shrink-0 text-xs ${inflightStatusClass(
                            inst.status,
                          )}`}
                        >
                          {inflightStatusLabel(inst.status)}
                        </span>
                      </div>
                    </li>
                  )}
                </For>
              </ul>
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

          <Show
            when={
              !loadingState() && !errorMessage() && !hasApps() && !hasCapsules()
            }
          >
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
              {props.onNavigateToStore ? (
                <div class="mt-5">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={props.onNavigateToStore}
                    leftIcon={<Icons.Download class="h-4 w-4" />}
                  >
                    {t("browseStore")}
                  </Button>
                </div>
              ) : null}
            </div>
          </Show>

          <Show when={!loadingState() && !errorMessage() && hasApps()}>
            <div class={LAUNCHER_GRID_CLASS}>
              {apps().map((app) => {
                const safeHref = toSafeHref(app.url);
                const iconImageSrc = getAppIconImageSrc(app.icon);
                const textIcon = getTextIcon(app);
                const title = getAppTitle(app, t);
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
                          class={`absolute right-1.5 top-1.5 h-2.5 w-2.5 rounded-full shadow-sm ring-2 ring-white dark:ring-zinc-900 ${getStatusDotClass(
                            app.service_status,
                          )}`}
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

          <Show when={!loadingState() && !errorMessage() && hasCapsules()}>
            <CapsuleInstallationsSection
              installations={workspaceCapsules()}
              t={t}
              lang={i18n.lang}
            />
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

function CapsuleInstallationsSection(props: {
  installations: readonly CapsuleInstallation[];
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  lang: string;
}) {
  const totalServices = () =>
    props.installations.reduce(
      (total, installation) => total + installation.services.length,
      0,
    );
  const readyServices = () =>
    props.installations.reduce(
      (total, installation) =>
        total +
        installation.services.filter((service) => service.status === "ready")
          .length,
      0,
    );

  return (
    <section class="mt-9">
      <div class="mb-3 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div class="min-w-0">
          <h2 class="text-base font-semibold text-zinc-900 dark:text-zinc-100">
            {props.t("appsCapsulesTitle")}
          </h2>
          <p class="text-sm text-zinc-500 dark:text-zinc-400">
            {props.t("appsCapsuleReadyOutputs", {
              ready: readyServices(),
              total: totalServices(),
            })}
          </p>
        </div>
      </div>
      <div class="grid gap-3 lg:grid-cols-2">
        <For each={props.installations}>
          {(installation) => (
            <CapsuleInstallationCard
              installation={installation}
              t={props.t}
              lang={props.lang}
            />
          )}
        </For>
      </div>
    </section>
  );
}

function CapsuleInstallationCard(props: {
  installation: CapsuleInstallation;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  lang: string;
}) {
  const visibleServices = () => props.installation.services.slice(0, 4);
  const primaryService = () => getPrimaryService(props.installation.services);
  const primaryHref = () => toSafeHref(primaryService()?.endpoint);
  const sourceLabel = () => getInstallationSourceLabel(props.installation);
  const updatedLabel = () =>
    formatInstallDate(props.installation.updatedAt, props.lang);

  return (
    <article class="rounded-lg border border-zinc-200 bg-white px-4 py-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div class="flex items-start gap-3">
        <div class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
          <Icons.Package class="h-5 w-5" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-start justify-between gap-3">
            <h3
              class="min-w-0 break-words text-sm font-semibold leading-5 text-zinc-900 dark:text-zinc-50"
              style="display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;"
            >
              {props.installation.name}
            </h3>
            <span
              class={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${getCapsuleStatusBadgeClass(
                props.installation.status,
              )}`}
            >
              {formatAppStatusLabel(props.installation.status, props.t)}
            </span>
          </div>
          <p class="mt-1 truncate text-xs text-zinc-500 dark:text-zinc-400">
            {sourceLabel()}
          </p>
        </div>
      </div>

      <div class="mt-4 flex min-h-8 flex-wrap gap-2">
        <Show
          when={visibleServices().length > 0}
          fallback={
            <span class="inline-flex items-center gap-1.5 rounded-md border border-dashed border-zinc-200 px-2 py-1 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              <Icons.Info class="h-3.5 w-3.5" />
              {props.t("appsCapsuleNoOutputs")}
            </span>
          }
        >
          <For each={visibleServices()}>
            {(service) => <CapsuleServiceChip service={service} t={props.t} />}
          </For>
        </Show>
      </div>

      <div class="mt-4 flex flex-col gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex min-w-0 flex-wrap items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
          <span>
            {props.t("appsCapsuleOutputs")}:{" "}
            {props.installation.services.length}
          </span>
          <Show when={updatedLabel()}>
            {(date) => (
              <span>{props.t("appsCapsuleUpdated", { date: date() })}</span>
            )}
          </Show>
        </div>
        <Show when={primaryHref()}>
          {(href) => (
            <a
              href={href()}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 text-sm font-medium text-white transition-colors hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300 dark:focus-visible:outline-zinc-100"
            >
              <Icons.ExternalLink class="h-4 w-4" />
              {props.t("appsCapsuleOpen")}
            </a>
          )}
        </Show>
      </div>
    </article>
  );
}

function CapsuleServiceChip(props: {
  service: CapsuleServiceSummary;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
}) {
  const href = () =>
    props.service.secret_configured ? null : toSafeHref(props.service.endpoint);
  const label = () => getServiceLabel(props.service);
  const endpoint = () => getEndpointLabel(props.service.endpoint);
  const Icon = getServiceIcon(props.service);

  return (
    <Show
      when={href()}
      fallback={
        <span
          class={`inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs ${getServiceChipClass(
            props.service.status,
          )}`}
          title={props.service.endpoint ?? props.service.capability}
        >
          <Icon class="h-3.5 w-3.5 shrink-0" />
          <span class="truncate">{label()}</span>
          <Show when={props.service.secret_configured}>
            <span class="shrink-0 text-zinc-400 dark:text-zinc-500">
              {props.t("appsCapsuleSecret")}
            </span>
          </Show>
        </span>
      }
    >
      {(safeHref) => (
        <a
          href={safeHref()}
          target="_blank"
          rel="noopener noreferrer"
          class={`inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800 ${getServiceChipClass(
            props.service.status,
          )}`}
          title={props.service.endpoint ?? props.service.capability}
        >
          <Icon class="h-3.5 w-3.5 shrink-0" />
          <span class="truncate">{label()}</span>
          <Show when={endpoint()}>
            {(value) => (
              <span class="max-w-[12rem] truncate text-zinc-400 dark:text-zinc-500">
                {value()}
              </span>
            )}
          </Show>
        </a>
      )}
    </Show>
  );
}

function getPrimaryService(
  services: readonly CapsuleServiceSummary[],
): CapsuleServiceSummary | null {
  return (
    services.find(
      (service) =>
        service.status === "ready" &&
        isLaunchService(service) &&
        toSafeHref(service.endpoint),
    ) ??
    services.find(
      (service) =>
        service.status === "ready" &&
        toSafeHref(service.endpoint) &&
        !service.secret_configured,
    ) ??
    null
  );
}

function isLaunchService(service: CapsuleServiceSummary): boolean {
  const key = `${service.id} ${service.capability}`.toLowerCase();
  return key.includes("launch") || key.includes("url") || key.includes("app");
}

function getInstallationSourceLabel(installation: CapsuleInstallation): string {
  const ref =
    installation.sourceCommit?.slice(0, 7) ??
    installation.sourceRef ??
    installation.mode ??
    installation.environment;
  const source = installation.sourceUrl
    ? getSourceDisplayName(installation.sourceUrl)
    : installation.mode;
  return [source, ref].filter(Boolean).join(" @ ") || installation.environment;
}

function getSourceDisplayName(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    const path = url.pathname.replace(/^\/+/, "").replace(/\.git$/i, "");
    return path || url.hostname;
  } catch {
    return sourceUrl.replace(/\.git$/i, "");
  }
}

function formatInstallDate(value: string | null, lang: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(lang === "ja" ? "ja-JP" : "en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function getCapsuleStatusBadgeClass(status: string): string {
  const normalized = status.toLowerCase();
  if (
    normalized === "ready" ||
    normalized === "deployed" ||
    normalized === "active"
  ) {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50";
  }
  if (
    normalized === "failed" ||
    normalized === "error" ||
    normalized === "degraded"
  ) {
    return "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/50";
  }
  if (
    normalized.includes("pending") ||
    normalized.includes("queue") ||
    normalized.includes("progress") ||
    normalized === "installing" ||
    normalized === "planning" ||
    normalized === "applying" ||
    normalized === "stale"
  ) {
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/50";
  }
  return "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700";
}

function getServiceChipClass(status: string): string {
  const normalized = status.toLowerCase();
  if (normalized === "ready") {
    return "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:ring-emerald-900/50";
  }
  if (normalized === "unavailable" || normalized === "error") {
    return "bg-red-50 text-red-700 ring-1 ring-red-200 dark:bg-red-950/30 dark:text-red-300 dark:ring-red-900/50";
  }
  if (normalized === "not_configured") {
    return "bg-amber-50 text-amber-700 ring-1 ring-amber-200 dark:bg-amber-950/30 dark:text-amber-300 dark:ring-amber-900/50";
  }
  return "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700";
}

function getServiceLabel(service: CapsuleServiceSummary): string {
  const id = service.id.replace(/^takos[_-]?/i, "");
  const normalized = id.toLowerCase();
  if (normalized.includes("launch") || normalized === "url") return "App";
  if (normalized.includes("mcp")) return "MCP";
  if (normalized.includes("file")) return "Files";
  if (
    normalized.includes("bucket") ||
    normalized.includes("storage") ||
    normalized.includes("object") ||
    normalized.includes("r2")
  ) {
    return "Storage";
  }
  if (normalized.includes("queue") || normalized.includes("event")) {
    return "Events";
  }
  if (
    normalized.includes("database") ||
    normalized.includes("d1") ||
    normalized === "db"
  ) {
    return "DB";
  }
  if (normalized.includes("oidc") || normalized.includes("identity")) {
    return "Identity";
  }
  return id
    .split(/[_\s.-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

function getServiceIcon(
  service: CapsuleServiceSummary,
): (props: Parameters<typeof Icons.Link>[0]) => ReturnType<typeof Icons.Link> {
  const key = `${service.id} ${service.capability}`.toLowerCase();
  if (key.includes("launch") || key.includes("url") || key.includes("app")) {
    return Icons.ExternalLink;
  }
  if (key.includes("mcp") || key.includes("link")) return Icons.Link;
  if (key.includes("file")) return Icons.File;
  if (
    key.includes("bucket") ||
    key.includes("storage") ||
    key.includes("object") ||
    key.includes("r2")
  ) {
    return Icons.Bucket;
  }
  if (key.includes("queue") || key.includes("event")) return Icons.Zap;
  if (key.includes("database") || key.includes("d1") || key.includes("db")) {
    return Icons.Database;
  }
  if (key.includes("secret") || key.includes("token")) return Icons.Lock;
  return Icons.Link;
}

function getEndpointLabel(endpoint: string | null): string | null {
  if (!endpoint) return null;
  try {
    const url = new URL(endpoint);
    return url.hostname || null;
  } catch {
    return endpoint.length > 24 ? `${endpoint.slice(0, 21)}...` : endpoint;
  }
}

function getStatusDotClass(status: string | null | undefined): string {
  const normalized = status?.toLowerCase();
  if (!normalized) return "bg-zinc-400";
  if (normalized === "deployed" || normalized === "active") {
    return "bg-emerald-500";
  }
  if (
    normalized === "failed" ||
    normalized === "error" ||
    normalized === "degraded"
  ) {
    return "bg-red-500";
  }
  if (
    normalized.includes("pending") ||
    normalized.includes("queue") ||
    normalized.includes("progress") ||
    normalized === "paused"
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

function getAppTitle(
  app: RegisteredApp,
  t: (key: TranslationKey) => string,
): string {
  return [
    app.name,
    app.description,
    app.category,
    formatAppTypeLabel(app.app_type, t),
    formatAppStatusLabel(app.service_status, t),
    app.space_name,
    app.service_hostname,
  ]
    .filter(Boolean)
    .join(" / ");
}
