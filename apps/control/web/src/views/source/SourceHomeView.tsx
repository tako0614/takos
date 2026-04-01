
import { Icons } from '../../lib/Icons.tsx';
import { useI18n } from '../../store/i18n.ts';
import type { SourceItem, SourceItemTakopack } from '../../hooks/useSourceData.ts';

/* ── AppTile: Compact tile for horizontal scroll sections ── */

function AppTile({
  item,
  takopack,
  installingId,
  onSelect,
  onInstall,
  onOpenRepo,
}: {
  item: SourceItem;
  takopack: SourceItemTakopack;
  installingId: string | null;
  onSelect: (item: SourceItem) => void;
  onInstall: (item: SourceItem) => void;
  onOpenRepo: (item: SourceItem) => void;
}) {
  const { t } = useI18n();
  const installing = installingId === item.id;
  const installed = item.installation?.installed ?? false;
  const ownerUsername = item.owner.username || item.owner.name || '?';
  const ownerInitial = ownerUsername.charAt(0).toUpperCase();

  return (
    <div class="flex-shrink-0 w-28 cursor-pointer" onClick={() => onSelect(item)}>
      {item.owner.avatar_url ? (
        <img src={item.owner.avatar_url} alt="" class="w-full aspect-square rounded-2xl object-cover mb-2" />
      ) : (
        <div class="w-full aspect-square rounded-2xl bg-gradient-to-br from-zinc-200 to-zinc-300 dark:from-zinc-700 dark:to-zinc-800 flex items-center justify-center text-2xl font-bold text-zinc-500 dark:text-zinc-400 mb-2">
          {ownerInitial}
        </div>
      )}
      <p class="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 truncate leading-tight mb-0.5">{item.name}</p>
      <p class="text-[10px] text-zinc-400 dark:text-zinc-500 truncate mb-2">@{ownerUsername}</p>
      <div onClick={(e) => e.stopPropagation()}>
        {installed ? (
          <div class="text-center text-[11px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 rounded-full py-1">
            {t('installed')}
          </div>
        ) : item.is_mine ? (
          <button
            type="button"
            class="w-full text-center text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 rounded-full py-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={() => onOpenRepo(item)}
          >
            {t('open')}
          </button>
        ) : takopack.available ? (
          <button
            type="button"
            disabled={installing}
            class="w-full text-center text-[11px] font-semibold text-white bg-zinc-900 dark:text-zinc-900 dark:bg-zinc-100 rounded-full py-1 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 transition-colors"
            onClick={() => onInstall(item)}
          >
            {installing ? '…' : t('install')}
          </button>
        ) : (
          <button
            type="button"
            class="w-full text-center text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded-full py-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={() => onOpenRepo(item)}
          >
            {t('viewLabel')}
          </button>
        )}
      </div>
    </div>
  );
}

/* ── Section: Horizontal scroll section ── */

function Section({
  title, items, onSeeAll, installingId, getItemTakopack, onSelect, onInstall, onOpenRepo,
}: {
  title: string;
  items: SourceItem[];
  onSeeAll: () => void;
  installingId: string | null;
  getItemTakopack: (item: SourceItem) => SourceItemTakopack;
  onSelect: (item: SourceItem) => void;
  onInstall: (item: SourceItem) => void;
  onOpenRepo: (item: SourceItem) => void;
}) {
  const { t } = useI18n();
  if (!items.length) return null;
  return (
    <div class="mb-7">
      <div class="flex items-baseline justify-between px-4 mb-3">
        <h2 class="text-[15px] font-bold text-zinc-900 dark:text-zinc-100">{title}</h2>
        <button
          type="button"
          class="text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          onClick={onSeeAll}
        >
          {t('seeAll')}
        </button>
      </div>
      <div class="flex gap-3.5 overflow-x-auto px-4 pb-1 scrollbar-none">
        {items.map((item) => (
          <AppTile

            item={item}
            takopack={getItemTakopack(item)}
            installingId={installingId}
            onSelect={onSelect}
            onInstall={onInstall}
            onOpenRepo={onOpenRepo}
          />
        ))}
      </div>
    </div>
  );
}

/* ── SourceHomeView ── */

interface SourceHomeViewProps {
  scrollContainerRef: HTMLDivElement | null | undefined;
  onScroll: () => void;
  items: SourceItem[];
  loading: boolean;
  installingId: string | null;
  getItemTakopack: (item: SourceItem) => SourceItemTakopack;
  onSelect: (item: SourceItem) => void;
  onInstall: (item: SourceItem) => void;
  onOpenRepo: (item: SourceItem) => void;
  onSeeAllTrending: () => void;
  onSeeAllOfficial: () => void;
  onSeeAllMine: () => void;
}

export function SourceHomeView({
  scrollContainerRef,
  onScroll,
  items,
  loading,
  installingId,
  getItemTakopack,
  onSelect,
  onInstall,
  onOpenRepo,
  onSeeAllTrending,
  onSeeAllOfficial,
  onSeeAllMine,
}: SourceHomeViewProps) {
  const { t } = useI18n();

  const official = items.filter((i) => i.official);
  const mine = items.filter((i) => i.is_mine);

  return (
    <div ref={scrollContainerRef as HTMLDivElement | undefined} onScroll={onScroll} class="flex-1 overflow-y-auto pt-2 pb-8">
      {loading && items.length === 0 ? (
        <div class="space-y-8 px-4">
          {[0, 1].map((_i) => (
            <div>
              <div class="w-20 h-3.5 rounded-full bg-zinc-200 dark:bg-zinc-800 animate-pulse mb-3" />
              <div class="flex gap-3.5">
                {[0, 1, 2, 3].map((_j) => (
                  <div class="flex-shrink-0 w-28">
                    <div class="w-full aspect-square rounded-2xl bg-zinc-200 dark:bg-zinc-800 animate-pulse mb-2" />
                    <div class="w-3/4 h-2.5 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse mb-1" />
                    <div class="w-1/2 h-2 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <>
          <Section
            title={t('sortTrending')}
            items={items.slice(0, 12)}
            onSeeAll={onSeeAllTrending}
            installingId={installingId}
            getItemTakopack={getItemTakopack}
            onSelect={onSelect}
            onInstall={onInstall}
            onOpenRepo={onOpenRepo}
          />
          {official.length > 0 && (
            <Section
              title={t('officialLabel')}
              items={official.slice(0, 12)}
              onSeeAll={onSeeAllOfficial}
              installingId={installingId}
              getItemTakopack={getItemTakopack}
              onSelect={onSelect}
              onInstall={onInstall}
              onOpenRepo={onOpenRepo}
            />
          )}
          {mine.length > 0 && (
            <Section
              title={t('myRepos')}
              items={mine.slice(0, 12)}
              onSeeAll={onSeeAllMine}
              installingId={installingId}
              getItemTakopack={getItemTakopack}
              onSelect={onSelect}
              onInstall={onInstall}
              onOpenRepo={onOpenRepo}
            />
          )}
          {items.length === 0 && (
            <div class="flex flex-col items-center justify-center py-20 gap-3">
              <div class="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                <Icons.Search class="w-7 h-7 text-zinc-400 opacity-60" />
              </div>
              <p class="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('noRepositoriesFound')}</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
