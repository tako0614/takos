import { useState } from 'react';
import { Icons } from '../../../lib/Icons';
import type { SourceItem, SourceItemTakopack } from '../../../hooks/useSourceData';

interface CatalogRepoCardProps {
  item: SourceItem;
  takopack: SourceItemTakopack;
  installingId: string | null;
  onSelect: (item: SourceItem) => void;
  onInstall: (item: SourceItem) => void;
  onStar: (item: SourceItem) => void;
  onOpenRepo: (item: SourceItem) => void;
  onManage: (action: 'rollback' | 'uninstall', item: SourceItem) => void;
}

export function CatalogRepoCard({
  item,
  takopack,
  installingId,
  onSelect,
  onInstall,
  onStar,
  onOpenRepo,
  onManage,
}: CatalogRepoCardProps) {
  const [manageOpen, setManageOpen] = useState(false);
  const installing = installingId === item.id;
  const installed = item.installation?.installed ?? false;

  const ownerUsername = item.owner.username || item.owner.name || '?';
  const ownerInitial = ownerUsername.charAt(0).toUpperCase();

  return (
    <article
      className="group relative rounded-2xl bg-white dark:bg-zinc-900 shadow-sm hover:shadow-md transition-shadow cursor-pointer flex flex-col p-3"
      onClick={() => onSelect(item)}
    >
      {/* App icon */}
      <div className="mb-2.5">
        {item.owner.avatar_url ? (
          <img
            src={item.owner.avatar_url}
            alt=""
            className="w-12 h-12 rounded-xl object-cover"
          />
        ) : (
          <div className="w-12 h-12 rounded-xl bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-xl font-bold text-zinc-500 dark:text-zinc-300">
            {ownerInitial}
          </div>
        )}
      </div>

      {/* Name */}
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 truncate leading-tight">
        {item.name}
      </h3>

      {/* Owner */}
      <p className="text-[11px] text-zinc-400 dark:text-zinc-500 truncate mt-0.5 mb-1.5">
        @{ownerUsername}
      </p>

      {/* Description */}
      {item.description ? (
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400 line-clamp-2 leading-relaxed flex-1">
          {item.description}
        </p>
      ) : (
        <div className="flex-1" />
      )}

      {/* Bottom row */}
      <div
        className="flex items-center justify-between mt-2.5 pt-2.5 border-t border-zinc-100 dark:border-zinc-800"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Star */}
        <button
          type="button"
          className={`flex items-center gap-1 text-[11px] transition-colors ${
            item.is_starred
              ? 'text-amber-500 dark:text-amber-400'
              : 'text-zinc-400 dark:text-zinc-500 hover:text-amber-500'
          }`}
          onClick={() => onStar(item)}
        >
          <Icons.Star className="w-3.5 h-3.5" />
          {item.stars > 0 ? item.stars : ''}
        </button>

        {/* Primary action */}
        {item.is_mine ? (
          <button
            type="button"
            className="text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
            onClick={() => onOpenRepo(item)}
          >
            Open
          </button>
        ) : installed ? (
          <div className="relative">
            <button
              type="button"
              className="flex items-center gap-0.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 transition-colors"
              onClick={() => setManageOpen((prev) => !prev)}
            >
              <Icons.Check className="w-3 h-3" />
              {item.installation?.installed_version ? `v${item.installation.installed_version}` : 'Installed'}
              <Icons.ChevronDown className="w-2.5 h-2.5 ml-0.5" />
            </button>
            {manageOpen && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setManageOpen(false)}
                />
                <div className="absolute right-0 bottom-full mb-1 z-20 bg-white dark:bg-zinc-900 rounded-xl shadow-xl border border-zinc-100 dark:border-zinc-800 overflow-hidden min-w-[130px]">
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-xs text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    onClick={() => { onManage('rollback', item); setManageOpen(false); }}
                  >
                    Rollback
                  </button>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-xs text-red-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    onClick={() => { onManage('uninstall', item); setManageOpen(false); }}
                  >
                    Uninstall
                  </button>
                </div>
              </>
            )}
          </div>
        ) : takopack.available ? (
          <button
            type="button"
            disabled={installing}
            className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:text-emerald-800 dark:hover:text-emerald-200 disabled:opacity-40 transition-colors"
            onClick={() => onInstall(item)}
          >
            {installing ? (
              <Icons.Loader className="w-3.5 h-3.5 animate-spin inline" />
            ) : (
              'Install'
            )}
          </button>
        ) : (
          <button
            type="button"
            className="text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
            onClick={() => onOpenRepo(item)}
          >
            View
          </button>
        )}
      </div>
    </article>
  );
}
