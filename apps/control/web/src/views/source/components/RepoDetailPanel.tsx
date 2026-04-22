import { Icons } from "../../../lib/Icons.tsx";
import {
  formatDetailedRelativeDate,
  formatNumber,
} from "../../../lib/format.ts";
import type {
  SourceItem,
  SourceItemPackage,
} from "../../../hooks/useSourceData.ts";
import type { TranslationKey } from "../../../store/i18n.ts";
import { useI18n } from "../../../store/i18n.ts";
import { getPackageIconImageSrc } from "../packageIcon.ts";

const CATEGORY_LABEL_KEYS: Record<string, TranslationKey> = {
  app: "categoryApps",
  service: "categoryServices",
  library: "categoryLibraries",
  template: "categoryTemplates",
  social: "categorySocial",
};

function getCategoryLabel(
  category: string,
  t: ReturnType<typeof useI18n>["t"],
) {
  const key = CATEGORY_LABEL_KEYS[category];
  return key ? t(key) : category;
}

interface RepoDetailPanelProps {
  item: SourceItem;
  pkg: SourceItemPackage;
  installingId: string | null;
  onClose: () => void;
  onInstall: (item: SourceItem) => void;
  onUninstall: (item: SourceItem) => void;
  onRollback: (item: SourceItem) => void;
  onStar: (item: SourceItem) => void;
  onOpenRepo: (item: SourceItem) => void;
}

export function RepoDetailPanel(props: RepoDetailPanelProps) {
  const { t } = useI18n();
  const installing = () => props.installingId === props.item.id;
  const installed = () => props.item.installation?.installed ?? false;
  const canStar = () => props.item.catalog_origin !== "default_app";
  const packageIconSrc = () => getPackageIconImageSrc(props.pkg.icon);

  const ownerUsername = () =>
    props.item.owner.username || props.item.owner.name || "?";
  const ownerInitial = () => ownerUsername().charAt(0).toUpperCase();

  return (
    <div
      class="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px]"
      onClick={props.onClose}
    >
      <aside
        class="absolute right-0 top-0 h-full w-full max-w-sm bg-white dark:bg-zinc-900 overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <div class="flex justify-end px-4 pt-4 flex-shrink-0">
          <button
            type="button"
            class="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={props.onClose}
            aria-label={t("close")}
          >
            <Icons.X class="w-4 h-4" />
          </button>
        </div>

        {/* App hero */}
        <div class="px-6 pb-5 flex flex-col items-center text-center">
          {packageIconSrc()
            ? (
              <img
                src={packageIconSrc()!}
                alt=""
                class="w-20 h-20 rounded-2xl object-cover shadow-md mb-4"
              />
            )
            : props.item.owner.avatar_url
            ? (
              <img
                src={props.item.owner.avatar_url}
                alt=""
                class="w-20 h-20 rounded-2xl object-cover shadow-md mb-4"
              />
            )
            : (
              <div class="w-20 h-20 rounded-2xl bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-3xl font-bold text-zinc-500 dark:text-zinc-300 shadow-md mb-4">
                {ownerInitial()}
              </div>
            )}

          <h2 class="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-1">
            {props.item.name}
          </h2>
          <p class="text-sm text-zinc-500 dark:text-zinc-400">
            @{ownerUsername()}
          </p>

          {/* Status badges */}
          <div class="flex flex-wrap justify-center gap-1.5 mt-2">
            {props.item.is_mine && (
              <span class="px-2.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-xs font-medium">
                {t("mine")}
              </span>
            )}
            {props.item.catalog_origin === "default_app" && (
              <span class="px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-300 text-xs font-medium">
                {t("default")}
              </span>
            )}
            {installed() && (
              <span class="px-2.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 text-xs font-medium flex items-center gap-1">
                <Icons.Check class="w-3 h-3" />
                {props.item.installation?.installed_version
                  ? `v${props.item.installation.installed_version}`
                  : t("installed")}
              </span>
            )}
            {props.pkg.certified && (
              <span class="px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-300 text-xs font-medium">
                {t("certified")}
              </span>
            )}
            {props.item.visibility === "private" && (
              <span class="px-2.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-xs flex items-center gap-1">
                <Icons.Lock class="w-3 h-3" />
                {t("private")}
              </span>
            )}
          </div>
        </div>

        {/* Stats strip */}
        <div class="flex items-center justify-center gap-6 px-6 py-3 border-y border-zinc-100 dark:border-zinc-800">
          {canStar()
            ? (
              <button
                type="button"
                class={`flex flex-col items-center gap-0.5 transition-colors ${
                  props.item.is_starred
                    ? "text-amber-500 dark:text-amber-400"
                    : "text-zinc-500 dark:text-zinc-400 hover:text-amber-500"
                }`}
                onClick={() => props.onStar(props.item)}
                aria-label={props.item.is_starred
                  ? t("unstarRepository", { name: props.item.name })
                  : t("starRepository", { name: props.item.name })}
                aria-pressed={props.item.is_starred}
              >
                <Icons.Star class="w-4 h-4" />
                <span class="text-xs font-medium">
                  {formatNumber(props.item.stars)}
                </span>
              </button>
            )
            : (
              <div class="flex flex-col items-center gap-0.5 text-blue-500 dark:text-blue-400">
                <Icons.Package class="w-4 h-4" />
                <span class="text-xs font-medium">{t("default")}</span>
              </div>
            )}
          <div class="flex flex-col items-center gap-0.5 text-zinc-400 dark:text-zinc-500">
            <Icons.GitMerge class="w-4 h-4" />
            <span class="text-xs">{formatNumber(props.item.forks)}</span>
          </div>
          {props.pkg.available && (
            <div class="flex flex-col items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
              <Icons.Download class="w-4 h-4" />
              <span class="text-xs">{formatNumber(props.pkg.downloads)}</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div class="flex-1 px-6 py-5 space-y-5">
          {/* Description */}
          {props.item.description && (
            <p class="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
              {props.item.description}
            </p>
          )}

          {/* Meta chips */}
          {(props.item.language || props.item.license ||
            props.item.category) && (
            <div class="flex flex-wrap gap-1.5">
              {props.item.category && (
                <span class="px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-xs">
                  {getCategoryLabel(props.item.category, t)}
                </span>
              )}
              {props.item.language && (
                <span class="px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-xs">
                  {props.item.language}
                </span>
              )}
              {props.item.license && (
                <span class="px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-xs">
                  {props.item.license.toUpperCase()}
                </span>
              )}
            </div>
          )}

          {/* Package section */}
          {props.pkg.available && (
            <div class="space-y-3">
              <div class="flex items-center gap-2">
                <Icons.Package class="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  {t("packageLabel")}
                </span>
                {props.pkg.latest_version && (
                  <span class="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ml-auto">
                    v{props.pkg.latest_version}
                  </span>
                )}
              </div>

              {props.pkg.description && (
                <p class="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  {props.pkg.description}
                </p>
              )}

              {props.pkg.tags.length > 0 && (
                <div class="flex flex-wrap gap-1.5">
                  {props.pkg.tags.map((tag) => (
                    <span class="px-2 py-0.5 text-[11px] rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Install / Installed actions */}
              {installed()
                ? (
                  <div class="space-y-2.5">
                    <p class="text-xs text-zinc-400 dark:text-zinc-500">
                      {props.item.installation?.deployed_at
                        ? t("installedAt", {
                          date: formatDetailedRelativeDate(
                            props.item.installation.deployed_at,
                          ),
                        })
                        : t("installed")}
                    </p>
                    <div class="flex gap-2">
                      <button
                        type="button"
                        class="flex-1 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                        onClick={() => props.onRollback(props.item)}
                      >
                        {t("rollback")}
                      </button>
                      <button
                        type="button"
                        class="flex-1 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                        onClick={() => props.onUninstall(props.item)}
                      >
                        {t("uninstall")}
                      </button>
                    </div>
                  </div>
                )
                : (
                  <button
                    type="button"
                    disabled={installing()}
                    class="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-semibold hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 transition-colors"
                    onClick={() => props.onInstall(props.item)}
                  >
                    {installing()
                      ? <Icons.Loader class="w-4 h-4 animate-spin" />
                      : <Icons.Download class="w-4 h-4" />}
                    {installing() ? t("installing") : t("install")}
                  </button>
                )}
            </div>
          )}

          {/* Open repo button */}
          <button
            type="button"
            class="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            onClick={() => props.onOpenRepo(props.item)}
          >
            <Icons.ExternalLink class="w-4 h-4" />
            {t("openRepository")}
          </button>

          {/* Updated */}
          <p class="text-xs text-zinc-400 dark:text-zinc-500 text-center">
            {t("updatedDate", {
              date: formatDetailedRelativeDate(props.item.updated_at),
            })}
          </p>
        </div>
      </aside>
    </div>
  );
}
