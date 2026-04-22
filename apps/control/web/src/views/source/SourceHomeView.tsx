import { createMemo } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import type {
  SourceItem,
  SourceItemPackage,
} from "../../hooks/useSourceData.ts";

/* ── AppTile: Compact tile for horizontal scroll sections ── */

function AppTile(props: {
  item: SourceItem;
  pkg: SourceItemPackage;
  installingId: string | null;
  onSelect: (item: SourceItem) => void;
  onInstall: (item: SourceItem) => void;
  onOpenRepo: (item: SourceItem) => void;
}) {
  const { t } = useI18n();
  const installing = () => props.installingId === props.item.id;
  const installed = () => props.item.installation?.installed ?? false;
  const ownerUsername = () =>
    props.item.owner.username || props.item.owner.name || "?";
  const ownerInitial = () => ownerUsername().charAt(0).toUpperCase();

  return (
    <div
      class="flex-shrink-0 w-28 cursor-pointer"
      onClick={() => props.onSelect(props.item)}
    >
      {props.item.owner.avatar_url
        ? (
          <img
            src={props.item.owner.avatar_url}
            alt=""
            class="w-full aspect-square rounded-2xl object-cover mb-2"
          />
        )
        : (
          <div class="w-full aspect-square rounded-2xl bg-gradient-to-br from-zinc-200 to-zinc-300 dark:from-zinc-700 dark:to-zinc-800 flex items-center justify-center text-2xl font-bold text-zinc-500 dark:text-zinc-400 mb-2">
            {ownerInitial()}
          </div>
        )}
      <p class="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 truncate leading-tight mb-0.5">
        {props.item.name}
      </p>
      <p class="text-[10px] text-zinc-400 dark:text-zinc-500 truncate mb-2">
        @{ownerUsername()}
      </p>
      <div onClick={(e) => e.stopPropagation()}>
        {installed()
          ? (
            <div class="text-center text-[11px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 rounded-full py-1">
              {t("installed")}
            </div>
          )
          : props.item.is_mine
          ? (
            <button
              type="button"
              class="w-full text-center text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 rounded-full py-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              onClick={() => props.onOpenRepo(props.item)}
            >
              {t("open")}
            </button>
          )
          : props.pkg.available
          ? (
            <button
              type="button"
              disabled={installing()}
              class="w-full text-center text-[11px] font-semibold text-white bg-zinc-900 dark:text-zinc-900 dark:bg-zinc-100 rounded-full py-1 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 transition-colors"
              onClick={() => props.onInstall(props.item)}
            >
              {installing() ? "…" : t("install")}
            </button>
          )
          : (
            <button
              type="button"
              class="w-full text-center text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded-full py-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              onClick={() => props.onOpenRepo(props.item)}
            >
              {t("viewLabel")}
            </button>
          )}
      </div>
    </div>
  );
}

/* ── Section: Horizontal scroll section ── */

function Section(props: {
  title: string;
  items: SourceItem[];
  onSeeAll: () => void;
  installingId: string | null;
  getItemPackage: (item: SourceItem) => SourceItemPackage;
  onSelect: (item: SourceItem) => void;
  onInstall: (item: SourceItem) => void;
  onOpenRepo: (item: SourceItem) => void;
}) {
  const { t } = useI18n();

  return (
    <>
      {props.items.length > 0 && (
        <div class="mb-7">
          <div class="flex items-baseline justify-between px-4 mb-3">
            <h2 class="text-[15px] font-bold text-zinc-900 dark:text-zinc-100">
              {props.title}
            </h2>
            <button
              type="button"
              class="text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
              onClick={props.onSeeAll}
            >
              {t("seeAll")}
            </button>
          </div>
          <div class="flex gap-3.5 overflow-x-auto px-4 pb-1 scrollbar-none">
            {props.items.map((item) => (
              <AppTile
                item={item}
                pkg={props.getItemPackage(item)}
                installingId={props.installingId}
                onSelect={props.onSelect}
                onInstall={props.onInstall}
                onOpenRepo={props.onOpenRepo}
              />
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ── SourceHomeView ── */

interface SourceHomeViewProps {
  scrollContainerRef: HTMLDivElement | null | undefined;
  onScroll: () => void;
  items: SourceItem[];
  loading: boolean;
  installingId: string | null;
  getItemPackage: (item: SourceItem) => SourceItemPackage;
  onSelect: (item: SourceItem) => void;
  onInstall: (item: SourceItem) => void;
  onOpenRepo: (item: SourceItem) => void;
  onSeeAllTrending: () => void;
  onSeeAllMine: () => void;
}

export function SourceHomeView(props: SourceHomeViewProps) {
  const { t } = useI18n();

  const mine = createMemo(() => props.items.filter((i) => i.is_mine));
  const trendingItems = () => props.items.slice(0, 12);
  const mineItems = () => mine().slice(0, 12);

  return (
    <div
      ref={props.scrollContainerRef as HTMLDivElement | undefined}
      onScroll={props.onScroll}
      class="flex-1 overflow-y-auto pt-2 pb-8"
    >
      {props.loading && props.items.length === 0
        ? (
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
        )
        : (
          <>
            <Section
              title={t("sortTrending")}
              items={trendingItems()}
              onSeeAll={props.onSeeAllTrending}
              installingId={props.installingId}
              getItemPackage={props.getItemPackage}
              onSelect={props.onSelect}
              onInstall={props.onInstall}
              onOpenRepo={props.onOpenRepo}
            />
            {mine().length > 0 && (
              <Section
                title={t("myRepos")}
                items={mineItems()}
                onSeeAll={props.onSeeAllMine}
                installingId={props.installingId}
                getItemPackage={props.getItemPackage}
                onSelect={props.onSelect}
                onInstall={props.onInstall}
                onOpenRepo={props.onOpenRepo}
              />
            )}
            {props.items.length === 0 && (
              <div class="flex flex-col items-center justify-center py-20 gap-3">
                <div class="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                  <Icons.Search class="w-7 h-7 text-zinc-400 opacity-60" />
                </div>
                <p class="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  {t("noRepositoriesFound")}
                </p>
              </div>
            )}
          </>
        )}
    </div>
  );
}
