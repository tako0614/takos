import { Icons } from "../../../lib/Icons.tsx";
import {
  formatDetailedRelativeDate,
  formatNumber,
} from "../../../lib/format.ts";
import type {
  SourceItem,
  SourceItemPackage,
} from "../../../hooks/useSourceData.ts";
import { useI18n } from "../../../store/i18n.ts";

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

export function RepoDetailPanel({
  item,
  pkg,
  installingId,
  onClose,
  onInstall,
  onUninstall,
  onRollback,
  onStar,
  onOpenRepo,
}: RepoDetailPanelProps) {
  const { t } = useI18n();
  const installing = installingId === item.id;
  const installed = item.installation?.installed ?? false;

  const ownerUsername = item.owner.username || item.owner.name || "?";
  const ownerInitial = ownerUsername.charAt(0).toUpperCase();

  return (
    <div
      class="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px]"
      onClick={onClose}
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
            onClick={onClose}
            aria-label={t("close") || "Close"}
          >
            <Icons.X class="w-4 h-4" />
          </button>
        </div>

        {/* App hero */}
        <div class="px-6 pb-5 flex flex-col items-center text-center">
          {item.owner.avatar_url
            ? (
              <img
                src={item.owner.avatar_url}
                alt=""
                class="w-20 h-20 rounded-2xl object-cover shadow-md mb-4"
              />
            )
            : (
              <div class="w-20 h-20 rounded-2xl bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-3xl font-bold text-zinc-500 dark:text-zinc-300 shadow-md mb-4">
                {ownerInitial}
              </div>
            )}

          <h2 class="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-1">
            {item.name}
          </h2>
          <p class="text-sm text-zinc-500 dark:text-zinc-400">
            @{ownerUsername}
          </p>

          {/* Status badges */}
          <div class="flex flex-wrap justify-center gap-1.5 mt-2">
            {item.is_mine && (
              <span class="px-2.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-xs font-medium">
                Mine
              </span>
            )}
            {installed && (
              <span class="px-2.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 text-xs font-medium flex items-center gap-1">
                <Icons.Check class="w-3 h-3" />
                {item.installation?.installed_version
                  ? `v${item.installation.installed_version}`
                  : "Installed"}
              </span>
            )}
            {pkg.certified && (
              <span class="px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-300 text-xs font-medium">
                Certified
              </span>
            )}
            {item.visibility === "private" && (
              <span class="px-2.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-xs flex items-center gap-1">
                <Icons.Lock class="w-3 h-3" />
                Private
              </span>
            )}
          </div>
        </div>

        {/* Stats strip */}
        <div class="flex items-center justify-center gap-6 px-6 py-3 border-y border-zinc-100 dark:border-zinc-800">
          <button
            type="button"
            class={`flex flex-col items-center gap-0.5 transition-colors ${
              item.is_starred
                ? "text-amber-500 dark:text-amber-400"
                : "text-zinc-500 dark:text-zinc-400 hover:text-amber-500"
            }`}
            onClick={() => onStar(item)}
          >
            <Icons.Star class="w-4 h-4" />
            <span class="text-xs font-medium">{formatNumber(item.stars)}</span>
          </button>
          <div class="flex flex-col items-center gap-0.5 text-zinc-400 dark:text-zinc-500">
            <Icons.GitMerge class="w-4 h-4" />
            <span class="text-xs">{formatNumber(item.forks)}</span>
          </div>
          {pkg.available && (
            <div class="flex flex-col items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
              <Icons.Download class="w-4 h-4" />
              <span class="text-xs">{formatNumber(pkg.downloads)}</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div class="flex-1 px-6 py-5 space-y-5">
          {/* Description */}
          {item.description && (
            <p class="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
              {item.description}
            </p>
          )}

          {/* Meta chips */}
          {(item.language || item.license || item.category) && (
            <div class="flex flex-wrap gap-1.5">
              {item.category && (
                <span class="px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-xs">
                  {item.category}
                </span>
              )}
              {item.language && (
                <span class="px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-xs">
                  {item.language}
                </span>
              )}
              {item.license && (
                <span class="px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-xs">
                  {item.license.toUpperCase()}
                </span>
              )}
            </div>
          )}

          {/* Package section */}
          {pkg.available && (
            <div class="space-y-3">
              <div class="flex items-center gap-2">
                <Icons.Package class="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Package
                </span>
                {pkg.latest_version && (
                  <span class="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ml-auto">
                    v{pkg.latest_version}
                  </span>
                )}
              </div>

              {pkg.description && (
                <p class="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  {pkg.description}
                </p>
              )}

              {pkg.tags.length > 0 && (
                <div class="flex flex-wrap gap-1.5">
                  {pkg.tags.map((tag) => (
                    <span class="px-2 py-0.5 text-[11px] rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Install / Installed actions */}
              {installed
                ? (
                  <div class="space-y-2.5">
                    <p class="text-xs text-zinc-400 dark:text-zinc-500">
                      Installed {item.installation?.deployed_at
                        ? formatDetailedRelativeDate(
                          item.installation.deployed_at,
                        )
                        : ""}
                    </p>
                    <div class="flex gap-2">
                      <button
                        type="button"
                        class="flex-1 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                        onClick={() => onRollback(item)}
                      >
                        Rollback
                      </button>
                      <button
                        type="button"
                        class="flex-1 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                        onClick={() => onUninstall(item)}
                      >
                        Uninstall
                      </button>
                    </div>
                  </div>
                )
                : (
                  <button
                    type="button"
                    disabled={installing}
                    class="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-semibold hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 transition-colors"
                    onClick={() => onInstall(item)}
                  >
                    {installing
                      ? <Icons.Loader class="w-4 h-4 animate-spin" />
                      : <Icons.Download class="w-4 h-4" />}
                    {installing ? "Installing…" : "Install"}
                  </button>
                )}
            </div>
          )}

          {/* Open repo button */}
          <button
            type="button"
            class="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            onClick={() => onOpenRepo(item)}
          >
            <Icons.ExternalLink class="w-4 h-4" />
            Open Repository
          </button>

          {/* Updated */}
          <p class="text-xs text-zinc-400 dark:text-zinc-500 text-center">
            Updated {formatDetailedRelativeDate(item.updated_at)}
          </p>
        </div>
      </aside>
    </div>
  );
}
