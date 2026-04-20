import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { CatalogRepoCard } from "./components/CatalogRepoCard.tsx";
import type {
  SourceFilter,
  SourceItem,
  SourceItemPackage,
} from "../../hooks/useSourceData.ts";

interface SourceBrowseViewProps {
  scrollContainerRef: HTMLDivElement | null | undefined;
  onScroll: () => void;
  items: SourceItem[];
  loading: boolean;
  hasMore: boolean;
  filter: SourceFilter;
  installingId: string | null;
  getItemPackage: (item: SourceItem) => SourceItemPackage;
  onSelect: (item: SourceItem) => void;
  onInstall: (item: SourceItem) => void;
  onStar: (item: SourceItem) => void;
  onOpenRepo: (item: SourceItem) => void;
  onRollback: (item: SourceItem) => void;
  onUninstall: (item: SourceItem) => void;
  loadMore: () => void;
  isAuthenticated: boolean;
  onRequireLogin: () => void;
  onCreateRepo: () => void;
}

export function SourceBrowseView({
  scrollContainerRef,
  onScroll,
  items,
  loading,
  hasMore,
  filter,
  installingId,
  getItemPackage,
  onSelect,
  onInstall,
  onStar,
  onOpenRepo,
  onRollback,
  onUninstall,
  loadMore,
  isAuthenticated,
  onRequireLogin,
  onCreateRepo,
}: SourceBrowseViewProps) {
  const { t } = useI18n();

  return (
    <div
      ref={scrollContainerRef as HTMLDivElement | undefined}
      onScroll={onScroll}
      class="flex-1 overflow-y-auto px-3 pb-6"
    >
      {loading && items.length === 0 && (
        <div class="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3 pt-1">
          {Array.from({ length: 6 }).map((_, _i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
            <div class="rounded-2xl bg-white dark:bg-zinc-800 h-44 animate-pulse" />
          ))}
        </div>
      )}

      {!loading && items.length === 0 && (
        <div class="flex flex-col items-center justify-center py-20 gap-3">
          <div class="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
            <Icons.Search class="w-7 h-7 text-zinc-400 opacity-60" />
          </div>
          <p class="text-sm font-medium text-zinc-500 dark:text-zinc-400">
            {filter === "mine"
              ? t("noRepositoriesYet")
              : filter === "starred"
              ? t("noStarredRepositories")
              : t("nothingFound")}
          </p>
          {filter === "mine" && (
            <button
              type="button"
              class="px-5 py-2 rounded-full bg-blue-600 dark:bg-blue-500 text-white text-sm font-medium hover:bg-blue-700 dark:hover:bg-blue-400 transition-colors"
              onClick={() => {
                if (!isAuthenticated) {
                  onRequireLogin();
                  return;
                }
                onCreateRepo();
              }}
            >
              {t("createRepository")}
            </button>
          )}
        </div>
      )}

      {items.length > 0 && (
        <>
          <div class="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3 pt-1">
            {items.map((item) => (
              <CatalogRepoCard
                item={item}
                pkg={getItemPackage(item)}
                installingId={installingId}
                onSelect={onSelect}
                onInstall={onInstall}
                onStar={onStar}
                onOpenRepo={onOpenRepo}
                onManage={(action, itm) => {
                  if (action === "rollback") onRollback(itm);
                  else onUninstall(itm);
                }}
              />
            ))}
          </div>
          {hasMore && (
            <div class="mt-6 flex justify-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loading}
                class="px-6 py-2.5 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 transition-colors"
              >
                {loading
                  ? <Icons.Loader class="w-4 h-4 animate-spin inline mr-1.5" />
                  : null}
                {t("loadMore")}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
