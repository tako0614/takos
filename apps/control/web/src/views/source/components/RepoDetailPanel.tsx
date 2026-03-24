import { Icons } from '../../../lib/Icons';
import { formatDetailedRelativeDate, formatNumber } from '../../../lib/format';
import type { SourceItem, SourceItemTakopack } from '../../../hooks/useSourceData';
import { useI18n } from '../../../providers/I18nProvider';

interface RepoDetailPanelProps {
  item: SourceItem;
  takopack: SourceItemTakopack;
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
  takopack,
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

  const ownerUsername = item.owner.username || item.owner.name || '?';
  const ownerInitial = ownerUsername.charAt(0).toUpperCase();

  return (
    <div
      className="fixed inset-0 z-30 bg-black/40 backdrop-blur-[1px]"
      onClick={onClose}
    >
      <aside
        className="absolute right-0 top-0 h-full w-full max-w-sm bg-white dark:bg-zinc-900 overflow-y-auto flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <div className="flex justify-end px-4 pt-4 flex-shrink-0">
          <button
            type="button"
            className="w-8 h-8 flex items-center justify-center rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={onClose}
            aria-label={t('close') || 'Close'}
          >
            <Icons.X className="w-4 h-4" />
          </button>
        </div>

        {/* App hero */}
        <div className="px-6 pb-5 flex flex-col items-center text-center">
          {item.owner.avatar_url ? (
            <img
              src={item.owner.avatar_url}
              alt=""
              className="w-20 h-20 rounded-2xl object-cover shadow-md mb-4"
            />
          ) : (
            <div className="w-20 h-20 rounded-2xl bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-3xl font-bold text-zinc-500 dark:text-zinc-300 shadow-md mb-4">
              {ownerInitial}
            </div>
          )}

          <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-100 mb-1">
            {item.name}
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            @{ownerUsername}
          </p>

          {/* Status badges */}
          <div className="flex flex-wrap justify-center gap-1.5 mt-2">
            {item.is_mine && (
              <span className="px-2.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-xs font-medium">
                Mine
              </span>
            )}
            {installed && (
              <span className="px-2.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 text-xs font-medium flex items-center gap-1">
                <Icons.Check className="w-3 h-3" />
                {item.installation?.installed_version ? `v${item.installation.installed_version}` : 'Installed'}
              </span>
            )}
            {takopack.certified && (
              <span className="px-2.5 py-0.5 rounded-full bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-300 text-xs font-medium">
                Certified
              </span>
            )}
            {item.visibility === 'private' && (
              <span className="px-2.5 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 text-xs flex items-center gap-1">
                <Icons.Lock className="w-3 h-3" />
                Private
              </span>
            )}
          </div>
        </div>

        {/* Stats strip */}
        <div className="flex items-center justify-center gap-6 px-6 py-3 border-y border-zinc-100 dark:border-zinc-800">
          <button
            type="button"
            className={`flex flex-col items-center gap-0.5 transition-colors ${
              item.is_starred
                ? 'text-amber-500 dark:text-amber-400'
                : 'text-zinc-500 dark:text-zinc-400 hover:text-amber-500'
            }`}
            onClick={() => onStar(item)}
          >
            <Icons.Star className="w-4 h-4" />
            <span className="text-xs font-medium">{formatNumber(item.stars)}</span>
          </button>
          <div className="flex flex-col items-center gap-0.5 text-zinc-400 dark:text-zinc-500">
            <Icons.GitMerge className="w-4 h-4" />
            <span className="text-xs">{formatNumber(item.forks)}</span>
          </div>
          {takopack.available && (
            <div className="flex flex-col items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
              <Icons.Download className="w-4 h-4" />
              <span className="text-xs">{formatNumber(takopack.downloads)}</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 px-6 py-5 space-y-5">

          {/* Description */}
          {item.description && (
            <p className="text-sm text-zinc-600 dark:text-zinc-300 leading-relaxed">
              {item.description}
            </p>
          )}

          {/* Meta chips */}
          {(item.language || item.license || item.category) && (
            <div className="flex flex-wrap gap-1.5">
              {item.category && (
                <span className="px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-xs">
                  {item.category}
                </span>
              )}
              {item.language && (
                <span className="px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-xs">
                  {item.language}
                </span>
              )}
              {item.license && (
                <span className="px-2.5 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-xs">
                  {item.license.toUpperCase()}
                </span>
              )}
            </div>
          )}

          {/* Takopack section */}
          {takopack.available && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Icons.Package className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Takopack</span>
                {takopack.latest_version && (
                  <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 ml-auto">
                    v{takopack.latest_version}
                  </span>
                )}
              </div>

              {takopack.description && (
                <p className="text-xs text-zinc-500 dark:text-zinc-400 leading-relaxed">
                  {takopack.description}
                </p>
              )}

              {takopack.tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {takopack.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 text-[11px] rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              )}

              {/* Install / Installed actions */}
              {installed ? (
                <div className="space-y-2.5">
                  <p className="text-xs text-zinc-400 dark:text-zinc-500">
                    Installed {item.installation?.deployed_at
                      ? formatDetailedRelativeDate(item.installation.deployed_at)
                      : ''}
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="flex-1 py-2 rounded-xl bg-zinc-100 dark:bg-zinc-800 text-xs font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                      onClick={() => onRollback(item)}
                    >
                      Rollback
                    </button>
                    <button
                      type="button"
                      className="flex-1 py-2 rounded-xl bg-red-50 dark:bg-red-900/20 text-xs font-medium text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
                      onClick={() => onUninstall(item)}
                    >
                      Uninstall
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  disabled={installing}
                  className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 text-sm font-semibold hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 transition-colors"
                  onClick={() => onInstall(item)}
                >
                  {installing ? (
                    <Icons.Loader className="w-4 h-4 animate-spin" />
                  ) : (
                    <Icons.Download className="w-4 h-4" />
                  )}
                  {installing ? 'Installing…' : 'Install'}
                </button>
              )}
            </div>
          )}

          {/* Open repo button */}
          <button
            type="button"
            className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-zinc-200 dark:border-zinc-700 text-sm font-medium text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors"
            onClick={() => onOpenRepo(item)}
          >
            <Icons.ExternalLink className="w-4 h-4" />
            Open Repository
          </button>

          {/* Updated */}
          <p className="text-xs text-zinc-400 dark:text-zinc-500 text-center">
            Updated {formatDetailedRelativeDate(item.updated_at)}
          </p>
        </div>
      </aside>
    </div>
  );
}
