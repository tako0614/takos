import { createEffect, onMount, onCleanup, createSignal } from 'solid-js';
import { Icons } from '../../lib/Icons.tsx';
import { useBreakpoint } from '../../hooks/useBreakpoint.ts';
import { useI18n } from '../../store/i18n.ts';
import { CreateRepoModal } from '../shared/repos/CreateRepoModal.tsx';
import type { Space } from '../../types/index.ts';
import { RepoDetailPanel } from './components/RepoDetailPanel.tsx';
import { useSourceData } from '../../hooks/useSourceData.ts';
import { useSourceViewUiState } from '../../hooks/useSourceViewUiState.ts';
import { SourceSearchBar } from './SourceSearchBar.tsx';
import {
  SourceFilterStatusBar,
  DesktopFilterBar,
  MobileFilterBar,
  MobileFiltersModal,
} from './SourceFilters.tsx';
import { SourceBrowseView } from './SourceBrowseView.tsx';
import { SourceHomeView } from './SourceHomeView.tsx';

interface SourcePageProps {
  spaces: Space[];
  onNavigateToRepo: (username: string, repoName: string) => void;
  isAuthenticated: boolean;
  onRequireLogin: () => void;
}

export function SourcePage({ spaces, onNavigateToRepo, isAuthenticated, onRequireLogin }: SourcePageProps) {
  const { t } = useI18n();
  const { isMobile } = useBreakpoint();
  let searchRef: HTMLInputElement | undefined;
  const [showMobileFilters, setShowMobileFilters] = createSignal(false);

  const {
    browseMode, setBrowseMode,
    scrollContainerRef,
    restoreScroll,
    handleContentScroll,
  } = useSourceViewUiState();

  const {
    filter, setFilter,
    sort, setSort,
    category, setCategory,
    officialOnly, setOfficialOnly,
    query, setQuery,
    items, loading, hasMore, total,
    selectedItem, setSelectedItem,
    installingId,
    searchFocused, setSearchFocused,
    suggestions, suggesting,
    showCreateModal, setShowCreateModal,
    loadMore,
    install, uninstall, rollback, toggleStar, createRepo, openRepo,
    getItemTakopack,
  } = useSourceData({ spaces, onNavigateToRepo, isAuthenticated, onRequireLogin });

  // Cmd/Ctrl+K to focus search
  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    onCleanup(() => window.removeEventListener('keydown', handler));
  });

  const isSearchMode = browseMode() || query().length > 0 || filter() !== 'all' || category() !== '' || officialOnly();
  const hasActiveFilters = filter() !== 'all' || category() !== '' || officialOnly();

  // Restore scroll position when switching between home/search
  createEffect(() => {
    return restoreScroll(isSearchMode);
  });

  const onContentScroll = () => {
    handleContentScroll(isSearchMode);
  };

  // Close mobile filters when leaving search mode
  createEffect(() => {
    if (!isSearchMode) {
      setShowMobileFilters(false);
    }
  });

  // Close mobile filters on breakpoint change
  createEffect(() => {
    setShowMobileFilters(false);
  });

  function exitSearch() {
    setBrowseMode(false);
    setQuery('');
    setFilter('all');
    setCategory('');
    setOfficialOnly(false);
    searchRef?.blur();
  }

  function clearFilters() {
    setFilter('all');
    setCategory('');
    setOfficialOnly(false);
  }

  return (
    <div class="h-full flex flex-col bg-zinc-50 dark:bg-zinc-900 overflow-hidden">
      <div class="max-w-2xl mx-auto w-full flex flex-col flex-1 min-h-0">

      {/* -- Header -- */}
      <div class="flex-shrink-0 px-4 pt-4 pb-3 md:pt-5">
        {!isSearchMode && (
          <div class="flex items-center justify-between mb-4">
            <h1 class="text-xl md:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{t('sourceTitle')}</h1>
            <div class="flex items-center gap-2">
              <button
                type="button"
                title={t('newRepository')}
                class="w-10 h-10 md:w-8 md:h-8 flex items-center justify-center rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
                onClick={() => {
                  if (!isAuthenticated) {
                    onRequireLogin();
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
          isSearchMode={isSearchMode}
          searchFocused={searchFocused()}
          setSearchFocused={setSearchFocused}
          suggesting={suggesting()}
          suggestions={suggestions()}
          onExitSearch={exitSearch}
          onFocusSearch={() => setBrowseMode(true)}
          onNavigateToRepo={onNavigateToRepo}
        />
      </div>

      {isSearchMode ? (
        <>
          <SourceFilterStatusBar
            loading={loading()}
            total={total()}
            hasActiveFilters={hasActiveFilters}
            onClearFilters={clearFilters}
          />

          {isMobile ? (
            <MobileFilterBar
              filter={filter()}
              sort={sort()}
              setSort={setSort}
              hasActiveFilters={hasActiveFilters}
              onShowFilters={() => setShowMobileFilters(true)}
            />
          ) : (
            <DesktopFilterBar
              filter={filter()}
              setFilter={setFilter}
              category={category()}
              setCategory={setCategory}
              officialOnly={officialOnly()}
              setOfficialOnly={setOfficialOnly}
              sort={sort()}
              setSort={setSort}
              isAuthenticated={isAuthenticated}
              onRequireLogin={onRequireLogin}
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
            getItemTakopack={getItemTakopack}
            onSelect={setSelectedItem}
            onInstall={install}
            onStar={toggleStar}
            onOpenRepo={openRepo}
            onRollback={rollback}
            onUninstall={uninstall}
            loadMore={loadMore}
            isAuthenticated={isAuthenticated}
            onRequireLogin={onRequireLogin}
            onCreateRepo={() => setShowCreateModal(true)}
          />
        </>
      ) : (
        <SourceHomeView
          scrollContainerRef={scrollContainerRef}
          onScroll={onContentScroll}
          items={items()}
          loading={loading()}
          installingId={installingId()}
          getItemTakopack={getItemTakopack}
          onSelect={setSelectedItem}
          onInstall={install}
          onOpenRepo={openRepo}
          onSeeAllTrending={() => { setBrowseMode(true); setSort('trending'); }}
          onSeeAllOfficial={() => { setBrowseMode(true); setOfficialOnly(true); }}
          onSeeAllMine={() => { setBrowseMode(true); setFilter('mine'); }}
        />
      )}

      </div>

      {isMobile && (
        <MobileFiltersModal
          isOpen={showMobileFilters()}
          onClose={() => setShowMobileFilters(false)}
          filter={filter()}
          setFilter={setFilter}
          category={category()}
          setCategory={setCategory}
          officialOnly={officialOnly()}
          setOfficialOnly={setOfficialOnly}
          isAuthenticated={isAuthenticated}
          onRequireLogin={onRequireLogin}
        />
      )}

      {selectedItem() && (
        <RepoDetailPanel
          item={selectedItem()!}
          takopack={getItemTakopack(selectedItem()!)}
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
