import { createEffect, createSignal, onCleanup, onMount } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useBreakpoint } from "../../hooks/useBreakpoint.ts";
import { useI18n } from "../../store/i18n.ts";
import { CreateRepoModal } from "../shared/repos/CreateRepoModal.tsx";
import type { Space } from "../../types/index.ts";
import { RepoDetailPanel } from "./components/RepoDetailPanel.tsx";
import { useSourceData } from "../../hooks/useSourceData.ts";
import { useSourceViewUiState } from "../../hooks/useSourceViewUiState.ts";
import { SourceSearchBar } from "./SourceSearchBar.tsx";
import {
  DesktopFilterBar,
  MobileFilterBar,
  MobileFiltersModal,
  SourceFilterStatusBar,
} from "./SourceFilters.tsx";
import { SourceBrowseView } from "./SourceBrowseView.tsx";
import { SourceHomeView } from "./SourceHomeView.tsx";

interface SourcePageProps {
  spaces: Space[];
  onNavigateToRepo: (username: string, repoName: string) => void;
  isAuthenticated: boolean;
  onRequireLogin: () => void;
}

export function SourcePage(props: SourcePageProps) {
  const { t } = useI18n();
  const breakpoint = useBreakpoint();
  let searchRef: HTMLInputElement | undefined;
  const [showMobileFilters, setShowMobileFilters] = createSignal(false);

  const {
    browseMode,
    setBrowseMode,
    scrollContainerRef,
    restoreScroll,
    handleContentScroll,
  } = useSourceViewUiState();

  const {
    filter,
    setFilter,
    sort,
    setSort,
    category,
    setCategory,
    query,
    setQuery,
    items,
    loading,
    hasMore,
    total,
    selectedItem,
    setSelectedItem,
    installingId,
    searchFocused,
    setSearchFocused,
    suggestions,
    suggesting,
    showCreateModal,
    setShowCreateModal,
    loadMore,
    install,
    uninstall,
    rollback,
    toggleStar,
    createRepo,
    openRepo,
    getItemPackage,
  } = useSourceData({
    spaces: () => props.spaces,
    onNavigateToRepo: (username, repoName) =>
      props.onNavigateToRepo(username, repoName),
    isAuthenticated: () => props.isAuthenticated,
    onRequireLogin: () => props.onRequireLogin(),
  });

  // Cmd/Ctrl+K to focus search
  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        searchRef?.focus();
      }
    };
    globalThis.addEventListener("keydown", handler);
    onCleanup(() => globalThis.removeEventListener("keydown", handler));
  });

  const isSearchMode = () =>
    browseMode() || query().length > 0 || filter() !== "all" ||
    category() !== "";
  const hasActiveFilters = () => filter() !== "all" || category() !== "";

  // Restore scroll position when switching between home/search
  createEffect(() => {
    return restoreScroll(isSearchMode());
  });

  const onContentScroll = () => {
    handleContentScroll(isSearchMode());
  };

  // Close mobile filters when leaving search mode
  createEffect(() => {
    if (!isSearchMode()) {
      setShowMobileFilters(false);
    }
  });

  // Close mobile filters on breakpoint change
  createEffect(() => {
    void breakpoint.isMobile;
    setShowMobileFilters(false);
  });

  function exitSearch() {
    setBrowseMode(false);
    setQuery("");
    setFilter("all");
    setCategory("");
    searchRef?.blur();
  }

  function clearFilters() {
    setFilter("all");
    setCategory("");
  }

  return (
    <div class="h-full flex flex-col bg-zinc-50 dark:bg-zinc-900 overflow-hidden">
      <div class="max-w-2xl mx-auto w-full flex flex-col flex-1 min-h-0">
        {/* -- Header -- */}
        <div class="flex-shrink-0 px-4 pt-4 pb-3 md:pt-5">
          {!isSearchMode() && (
            <div class="flex items-center justify-between mb-4">
              <h1 class="text-xl md:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
                {t("sourceTitle")}
              </h1>
              <div class="flex items-center gap-2">
                <button
                  type="button"
                  title={t("newRepository")}
                  aria-label={t("newRepository")}
                  class="w-10 h-10 md:w-8 md:h-8 flex items-center justify-center rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
                  onClick={() => {
                    if (!props.isAuthenticated) {
                      props.onRequireLogin();
                      return;
                    }
                    setShowCreateModal(true);
                  }}
                >
                  <Icons.Plus class="w-4 h-4" />
                </button>
              </div>
            </div>
          )}

          <SourceSearchBar
            searchRef={searchRef}
            query={query()}
            setQuery={setQuery}
            isSearchMode={isSearchMode()}
            searchFocused={searchFocused()}
            setSearchFocused={setSearchFocused}
            suggesting={suggesting()}
            suggestions={suggestions()}
            onExitSearch={exitSearch}
            onFocusSearch={() => setBrowseMode(true)}
            onNavigateToRepo={props.onNavigateToRepo}
          />
        </div>

        {isSearchMode()
          ? (
            <>
              <SourceFilterStatusBar
                loading={loading()}
                total={total()}
                hasActiveFilters={hasActiveFilters()}
                onClearFilters={clearFilters}
              />

              {breakpoint.isMobile
                ? (
                  <MobileFilterBar
                    filter={filter()}
                    sort={sort()}
                    setSort={setSort}
                    hasActiveFilters={hasActiveFilters()}
                    onShowFilters={() => setShowMobileFilters(true)}
                  />
                )
                : (
                  <DesktopFilterBar
                    filter={filter()}
                    setFilter={setFilter}
                    category={category()}
                    setCategory={setCategory}
                    sort={sort()}
                    setSort={setSort}
                    isAuthenticated={props.isAuthenticated}
                    onRequireLogin={props.onRequireLogin}
                  />
                )}

              <SourceBrowseView
                scrollContainerRef={scrollContainerRef}
                onScroll={onContentScroll}
                items={items()}
                loading={loading()}
                hasMore={hasMore()}
                filter={filter()}
                installingId={installingId()}
                getItemPackage={getItemPackage}
                onSelect={setSelectedItem}
                onInstall={install}
                onStar={toggleStar}
                onOpenRepo={openRepo}
                onRollback={rollback}
                onUninstall={uninstall}
                loadMore={loadMore}
                isAuthenticated={props.isAuthenticated}
                onRequireLogin={props.onRequireLogin}
                onCreateRepo={() => setShowCreateModal(true)}
              />
            </>
          )
          : (
            <SourceHomeView
              scrollContainerRef={scrollContainerRef}
              onScroll={onContentScroll}
              items={items()}
              loading={loading()}
              installingId={installingId()}
              getItemPackage={getItemPackage}
              onSelect={setSelectedItem}
              onInstall={install}
              onOpenRepo={openRepo}
              onSeeAllTrending={() => {
                setBrowseMode(true);
                setSort("trending");
              }}
              onSeeAllMine={() => {
                setBrowseMode(true);
                setFilter("mine");
              }}
            />
          )}
      </div>

      {breakpoint.isMobile && (
        <MobileFiltersModal
          isOpen={showMobileFilters()}
          onClose={() => setShowMobileFilters(false)}
          filter={filter()}
          setFilter={setFilter}
          category={category()}
          setCategory={setCategory}
          isAuthenticated={props.isAuthenticated}
          onRequireLogin={props.onRequireLogin}
        />
      )}

      {selectedItem() && (
        <RepoDetailPanel
          item={selectedItem()!}
          pkg={getItemPackage(selectedItem()!)}
          installingId={installingId()}
          onClose={() => setSelectedItem(null)}
          onInstall={install}
          onUninstall={uninstall}
          onRollback={rollback}
          onStar={toggleStar}
          onOpenRepo={openRepo}
        />
      )}

      {showCreateModal() && (
        <CreateRepoModal
          onClose={() => setShowCreateModal(false)}
          onCreate={createRepo}
        />
      )}
    </div>
  );
}
