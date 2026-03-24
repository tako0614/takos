import { useCallback, useEffect, useRef, useState } from 'react';
import { Icons } from '../../lib/Icons';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useI18n } from '../../providers/I18nProvider';
import { Modal } from '../../components/ui/Modal';
import { CreateRepoModal } from '../shared/repos/CreateRepoModal';
import type { Workspace } from '../../types';
import { CatalogRepoCard } from './components/CatalogRepoCard';
import { RepoDetailPanel } from './components/RepoDetailPanel';
import { useSourceData, type SourceFilter, type SourceSort } from '../../hooks/useSourceData';
import type { SourceItem, SourceItemTakopack } from '../../hooks/useSourceData';

interface SourcePageProps {
  workspaces: Workspace[];
  onNavigateToRepo: (username: string, repoName: string) => void;
  isAuthenticated: boolean;
  onRequireLogin: () => void;
}

const FILTER_CHIPS: Array<{ value: SourceFilter; labelKey: string }> = [
  { value: 'all', labelKey: 'sourceFilterAll' },
  { value: 'mine', labelKey: 'sourceFilterMine' },
  { value: 'starred', labelKey: 'sourceFilterStarred' },
];

const CATEGORY_CHIPS = [
  { value: 'app', labelKey: 'categoryApps' },
  { value: 'service', labelKey: 'categoryServices' },
  { value: 'library', labelKey: 'categoryLibraries' },
  { value: 'template', labelKey: 'categoryTemplates' },
  { value: 'social', labelKey: 'categorySocial' },
];

const SORT_OPTIONS: Array<{ value: SourceSort; labelKey: string }> = [
  { value: 'trending', labelKey: 'sortTrending' },
  { value: 'new', labelKey: 'sortNew' },
  { value: 'stars', labelKey: 'sortStars' },
  { value: 'updated', labelKey: 'sortUpdated' },
];

const SOURCE_VIEW_UI_STATE_KEY = 'takos.source.view-ui-state.v1';

type SourceViewUiState = {
  browseMode: boolean;
  homeScrollTop: number;
  searchScrollTop: number;
};

function readSourceViewUiState(): Partial<SourceViewUiState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(SOURCE_VIEW_UI_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<SourceViewUiState> & { scrollTop?: number };
    const legacyScrollTop = typeof parsed.scrollTop === 'number' && Number.isFinite(parsed.scrollTop)
      ? parsed.scrollTop
      : undefined;
    return {
      browseMode: typeof parsed.browseMode === 'boolean' ? parsed.browseMode : undefined,
      homeScrollTop: typeof parsed.homeScrollTop === 'number' && Number.isFinite(parsed.homeScrollTop)
        ? parsed.homeScrollTop
        : legacyScrollTop,
      searchScrollTop: typeof parsed.searchScrollTop === 'number' && Number.isFinite(parsed.searchScrollTop)
        ? parsed.searchScrollTop
        : undefined,
    };
  } catch {
    return {};
  }
}

function writeSourceViewUiState(nextState: SourceViewUiState) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SOURCE_VIEW_UI_STATE_KEY, JSON.stringify(nextState));
  } catch {
    // noop
  }
}

// Compact tile for horizontal scroll sections
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
    <div className="flex-shrink-0 w-28 cursor-pointer" onClick={() => onSelect(item)}>
      {item.owner.avatar_url ? (
        <img src={item.owner.avatar_url} alt="" className="w-full aspect-square rounded-2xl object-cover mb-2" />
      ) : (
        <div className="w-full aspect-square rounded-2xl bg-gradient-to-br from-zinc-200 to-zinc-300 dark:from-zinc-700 dark:to-zinc-800 flex items-center justify-center text-2xl font-bold text-zinc-500 dark:text-zinc-400 mb-2">
          {ownerInitial}
        </div>
      )}
      <p className="text-[11px] font-semibold text-zinc-900 dark:text-zinc-100 truncate leading-tight mb-0.5">{item.name}</p>
      <p className="text-[10px] text-zinc-400 dark:text-zinc-500 truncate mb-2">@{ownerUsername}</p>
      <div onClick={(e) => e.stopPropagation()}>
        {installed ? (
          <div className="text-center text-[11px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 rounded-full py-1">
            {t('installed')}
          </div>
        ) : item.is_mine ? (
          <button
            type="button"
            className="w-full text-center text-[11px] font-semibold text-zinc-600 dark:text-zinc-300 bg-zinc-100 dark:bg-zinc-800 rounded-full py-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={() => onOpenRepo(item)}
          >
            {t('open')}
          </button>
        ) : takopack.available ? (
          <button
            type="button"
            disabled={installing}
            className="w-full text-center text-[11px] font-semibold text-white bg-zinc-900 dark:text-zinc-900 dark:bg-zinc-100 rounded-full py-1 hover:bg-zinc-700 dark:hover:bg-zinc-300 disabled:opacity-50 transition-colors"
            onClick={() => onInstall(item)}
          >
            {installing ? '…' : t('install')}
          </button>
        ) : (
          <button
            type="button"
            className="w-full text-center text-[11px] font-semibold text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded-full py-1 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={() => onOpenRepo(item)}
          >
            {t('viewLabel')}
          </button>
        )}
      </div>
    </div>
  );
}

// Horizontal scroll section component
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
    <div className="mb-7">
      <div className="flex items-baseline justify-between px-4 mb-3">
        <h2 className="text-[15px] font-bold text-zinc-900 dark:text-zinc-100">{title}</h2>
        <button
          type="button"
          className="text-xs font-medium text-zinc-500 dark:text-zinc-400 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          onClick={onSeeAll}
        >
          {t('seeAll')}
        </button>
      </div>
      <div className="flex gap-3.5 overflow-x-auto px-4 pb-1 scrollbar-none">
        {items.map((item) => (
          <AppTile
            key={item.id}
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

export function SourcePage({ workspaces, onNavigateToRepo, isAuthenticated, onRequireLogin }: SourcePageProps) {
  const { t } = useI18n();
  const { isMobile } = useBreakpoint();
  const searchRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const initialSourceViewUiState = useState<SourceViewUiState>(() => {
    const persisted = readSourceViewUiState();
    return {
      browseMode: persisted.browseMode ?? false,
      homeScrollTop: persisted.homeScrollTop ?? 0,
      searchScrollTop: persisted.searchScrollTop ?? 0,
    };
  })[0];
  const sourceViewUiStateRef = useRef<SourceViewUiState>(initialSourceViewUiState);
  const [browseMode, setBrowseMode] = useState(initialSourceViewUiState.browseMode);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const {
    filter, setFilter,
    sort, setSort,
    category, setCategory,
    installableOnly, setInstallableOnly,
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
  } = useSourceData({ workspaces, onNavigateToRepo, isAuthenticated, onRequireLogin });

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const isSearchMode = browseMode || query.length > 0 || filter !== 'all' || category !== '' || installableOnly;

  const persistSourceViewUiState = useCallback((nextState: Partial<SourceViewUiState>) => {
    sourceViewUiStateRef.current = { ...sourceViewUiStateRef.current, ...nextState };
    writeSourceViewUiState(sourceViewUiStateRef.current);
  }, []);

  useEffect(() => {
    persistSourceViewUiState({ browseMode });
  }, [browseMode, persistSourceViewUiState]);

  useEffect(() => {
    const targetScrollTop = isSearchMode
      ? sourceViewUiStateRef.current.searchScrollTop
      : sourceViewUiStateRef.current.homeScrollTop;
    const rafId = window.requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = targetScrollTop;
      }
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [isSearchMode]);

  const handleContentScroll = useCallback(() => {
    const currentScrollTop = scrollContainerRef.current?.scrollTop ?? 0;
    if (isSearchMode) {
      persistSourceViewUiState({ searchScrollTop: currentScrollTop });
      return;
    }
    persistSourceViewUiState({ homeScrollTop: currentScrollTop });
  }, [isSearchMode, persistSourceViewUiState]);

  useEffect(() => {
    if (!isSearchMode) {
      setShowMobileFilters(false);
    }
  }, [isSearchMode]);

  useEffect(() => {
    setShowMobileFilters(false);
  }, [isMobile]);

  function exitSearch() {
    setBrowseMode(false);
    setQuery('');
    setFilter('all');
    setCategory('');
    setInstallableOnly(false);
    setSortOpen(false);
    searchRef.current?.blur();
  }

  const installable = items.filter((i) => getItemTakopack(i).available);
  const mine = items.filter((i) => i.is_mine);
  const currentSortOpt = SORT_OPTIONS.find((o) => o.value === sort) ?? SORT_OPTIONS[0];
  const hasActiveFilters = filter !== 'all' || category !== '' || installableOnly;

  return (
    <div className="h-full flex flex-col bg-zinc-50 dark:bg-zinc-900 overflow-hidden">
      <div className="max-w-2xl mx-auto w-full flex flex-col flex-1 min-h-0">

      {/* ── Header ── */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 md:pt-5">
        {!isSearchMode && (
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">{t('sourceTitle')}</h1>
            <div className="flex items-center gap-2">
              <button
                type="button"
                title={t('newRepository')}
                className="w-10 h-10 md:w-8 md:h-8 flex items-center justify-center rounded-full bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-700 dark:hover:bg-zinc-300 transition-colors"
                onClick={() => {
                  if (!isAuthenticated) {
                    onRequireLogin();
                    return;
                  }
                  setShowCreateModal(true);
                }}
              >
                <Icons.Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Search bar */}
        <div className="relative">
          {isSearchMode ? (
            <button
              type="button"
              className="absolute left-3 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
              onClick={exitSearch}
            >
              <Icons.ChevronLeft className="w-5 h-5" />
            </button>
          ) : (
            <Icons.Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
          )}
          <input
            ref={searchRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => { setSearchFocused(true); setBrowseMode(true); }}
            onBlur={() => setTimeout(() => setSearchFocused(false), 150)}
            placeholder={t('searchReposAndPackages')}
            className="w-full h-12 md:h-11 pl-10 pr-10 rounded-2xl bg-white dark:bg-zinc-900 shadow-sm text-base md:text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 border-none outline-none focus:ring-2 focus:ring-blue-400/30 dark:focus:ring-blue-500/30 transition-all"
          />
          {suggesting && (
            <Icons.Loader className="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 animate-spin" />
          )}
          {query && !suggesting && (
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-600 transition-colors"
              onClick={() => setQuery('')}
            >
              <Icons.X className="w-4 h-4" />
            </button>
          )}

          {/* Suggestions dropdown */}
          {searchFocused && query.trim() && (suggestions.users.length > 0 || suggestions.repos.length > 0) && (
            <div className="absolute z-20 left-0 right-0 mt-2 rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
              {suggestions.users.length > 0 && (
                <div className="py-1">
                  <p className="px-4 pt-2 pb-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">{t('usersLabel')}</p>
                  {suggestions.users.map((user) => (
                    <div
                      key={user.username}
                      className="flex items-center gap-2 px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setQuery(`@${user.username}`)}
                    >
                      {user.avatar_url
                        ? <img src={user.avatar_url} alt="" className="w-6 h-6 rounded-full" />
                        : <div className="w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[10px]">{user.username.charAt(0).toUpperCase()}</div>
                      }
                      <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">@{user.username}</span>
                      {user.name && <span className="text-xs text-zinc-400">{user.name}</span>}
                    </div>
                  ))}
                </div>
              )}
              {suggestions.repos.length > 0 && (
                <div className={suggestions.users.length > 0 ? 'border-t border-zinc-100 dark:border-zinc-800 py-1' : 'py-1'}>
                  <p className="px-4 pt-2 pb-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">{t('repositories')}</p>
                  {suggestions.repos.map((repo) => (
                    <button
                      key={`${repo.owner.username}/${repo.name}`}
                      type="button"
                      className="w-full text-left px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => onNavigateToRepo(repo.owner.username, repo.name)}
                    >
                      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{repo.owner.username}/{repo.name}</p>
                      {repo.description && <p className="text-xs text-zinc-400 truncate">{repo.description}</p>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {isSearchMode ? (
        /* ── Browse / Search view ── */
        <>
          <div className="flex-shrink-0 px-4 pb-2 text-xs text-zinc-500 dark:text-zinc-400 flex items-center justify-between">
            <span>{loading ? t('searchingEllipsis') : t('resultsCount', { count: String(total) })}</span>
            {hasActiveFilters && (
              <button
                type="button"
                className="text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                onClick={() => {
                  setFilter('all');
                  setCategory('');
                  setInstallableOnly(false);
                }}
              >
                {t('clearFilters')}
              </button>
            )}
          </div>

          {isMobile ? (
            <div className="flex-shrink-0 px-4 pb-3 flex items-center gap-2">
              <button
                type="button"
                className={`min-h-[44px] px-3.5 rounded-xl text-xs font-medium border transition-colors ${
                  hasActiveFilters
                    ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
                    : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700'
                }`}
                onClick={() => setShowMobileFilters(true)}
              >
                {t('filtersTitle')}
              </button>
              {filter !== 'mine' && (
                <div className="relative flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setSortOpen((v) => !v)}
                    className="min-h-[44px] flex items-center gap-1 px-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    {t(currentSortOpt.labelKey as never)}
                    <Icons.ChevronDown className="w-3 h-3" />
                  </button>
                  {sortOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                      <div className="absolute left-0 top-full mt-1 z-20 bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-100 dark:border-zinc-800 overflow-hidden min-w-[130px]">
                        {SORT_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => { setSort(opt.value); setSortOpen(false); }}
                            className={`w-full text-left px-4 py-2.5 text-xs transition-colors ${
                              sort === opt.value
                                ? 'text-zinc-900 dark:text-zinc-100 font-semibold'
                                : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                            }`}
                          >
                            {t(opt.labelKey as never)}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-shrink-0 flex items-center gap-1.5 px-4 pb-3 overflow-x-auto scrollbar-none">
              {FILTER_CHIPS.map((chip) => (
                <button
                  key={chip.value}
                  type="button"
                  onClick={() => {
                    if (!isAuthenticated && (chip.value === 'mine' || chip.value === 'starred')) {
                      onRequireLogin();
                      return;
                    }
                    setFilter(chip.value);
                  }}
                  className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    filter === chip.value
                      ? 'bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900'
                      : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {t(chip.labelKey as never)}
                </button>
              ))}

              <div className="w-px h-4 bg-zinc-200 dark:bg-zinc-700 flex-shrink-0 mx-0.5" />

              {CATEGORY_CHIPS.map((chip) => (
                <button
                  key={chip.value}
                  type="button"
                  onClick={() => setCategory(category === chip.value ? '' : chip.value)}
                  className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    category === chip.value
                      ? 'bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900'
                      : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  {t(chip.labelKey as never)}
                </button>
              ))}

              {filter !== 'mine' && (
                <button
                  type="button"
                  onClick={() => setInstallableOnly((v) => !v)}
                  className={`flex-shrink-0 flex items-center gap-1 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
                    installableOnly
                      ? 'bg-emerald-600 text-white'
                      : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800'
                  }`}
                >
                  <Icons.Package className="w-3 h-3" />
                  {t('installableLabel')}
                </button>
              )}

              {filter !== 'mine' && (
                <div className="relative ml-auto flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => setSortOpen((v) => !v)}
                    className="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                  >
                    {t(currentSortOpt.labelKey as never)}
                    <Icons.ChevronDown className="w-3 h-3" />
                  </button>
                  {sortOpen && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                      <div className="absolute right-0 top-full mt-1 z-20 bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-100 dark:border-zinc-800 overflow-hidden min-w-[120px]">
                        {SORT_OPTIONS.map((opt) => (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => { setSort(opt.value); setSortOpen(false); }}
                            className={`w-full text-left px-4 py-2.5 text-xs transition-colors ${
                              sort === opt.value
                                ? 'text-zinc-900 dark:text-zinc-100 font-semibold'
                                : 'text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800'
                            }`}
                          >
                            {t(opt.labelKey as never)}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          )}

          <div ref={scrollContainerRef} onScroll={handleContentScroll} className="flex-1 overflow-y-auto px-3 pb-6">
            {loading && items.length === 0 && (
              <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3 pt-1">
                {Array.from({ length: 6 }).map((_, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: skeleton
                  <div key={i} className="rounded-2xl bg-white dark:bg-zinc-800 h-44 animate-pulse" />
                ))}
              </div>
            )}

            {!loading && items.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                  <Icons.Search className="w-7 h-7 text-zinc-400 opacity-60" />
                </div>
                <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">
                  {filter === 'mine' ? t('noRepositoriesYet')
                    : filter === 'starred' ? t('noStarredRepositories')
                    : t('nothingFound')}
                </p>
                {filter === 'mine' && (
                  <button
                    type="button"
                    className="px-5 py-2 rounded-full bg-blue-600 dark:bg-blue-500 text-white text-sm font-medium hover:bg-blue-700 dark:hover:bg-blue-400 transition-colors"
                    onClick={() => {
                      if (!isAuthenticated) {
                        onRequireLogin();
                        return;
                      }
                      setShowCreateModal(true);
                    }}
                  >
                    {t('createRepository')}
                  </button>
                )}
              </div>
            )}

            {items.length > 0 && (
              <>
                <div className="grid grid-cols-1 min-[380px]:grid-cols-2 gap-3 pt-1">
                  {items.map((item) => (
                    <CatalogRepoCard
                      key={item.id}
                      item={item}
                      takopack={getItemTakopack(item)}
                      installingId={installingId}
                      onSelect={setSelectedItem}
                      onInstall={install}
                      onStar={toggleStar}
                      onOpenRepo={openRepo}
                      onManage={(action, itm) => {
                        if (action === 'rollback') rollback(itm);
                        else uninstall(itm);
                      }}
                    />
                  ))}
                </div>
                {hasMore && (
                  <div className="mt-6 flex justify-center">
                    <button
                      type="button"
                      onClick={loadMore}
                      disabled={loading}
                      className="px-6 py-2.5 rounded-full bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800 disabled:opacity-40 transition-colors"
                    >
                      {loading ? <Icons.Loader className="w-4 h-4 animate-spin inline mr-1.5" /> : null}
                      {t('loadMore')}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      ) : (
        /* ── Home discovery view ── */
        <div ref={scrollContainerRef} onScroll={handleContentScroll} className="flex-1 overflow-y-auto pt-2 pb-8">
          {loading && items.length === 0 ? (
            <div className="space-y-8 px-4">
              {[0, 1].map((i) => (
                <div key={i}>
                  <div className="w-20 h-3.5 rounded-full bg-zinc-200 dark:bg-zinc-800 animate-pulse mb-3" />
                  <div className="flex gap-3.5">
                    {[0, 1, 2, 3].map((j) => (
                      <div key={j} className="flex-shrink-0 w-28">
                        <div className="w-full aspect-square rounded-2xl bg-zinc-200 dark:bg-zinc-800 animate-pulse mb-2" />
                        <div className="w-3/4 h-2.5 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse mb-1" />
                        <div className="w-1/2 h-2 rounded bg-zinc-200 dark:bg-zinc-800 animate-pulse" />
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
                onSeeAll={() => { setBrowseMode(true); setSort('trending'); }}
                installingId={installingId}
                getItemTakopack={getItemTakopack}
                onSelect={setSelectedItem}
                onInstall={install}
                onOpenRepo={openRepo}
              />
              {installable.length > 0 && (
                <Section
                  title={t('installableLabel')}
                  items={installable.slice(0, 12)}
                  onSeeAll={() => { setBrowseMode(true); setInstallableOnly(true); }}
                  installingId={installingId}
                  getItemTakopack={getItemTakopack}
                  onSelect={setSelectedItem}
                  onInstall={install}
                  onOpenRepo={openRepo}
                />
              )}
              {mine.length > 0 && (
                <Section
                  title={t('myRepos')}
                  items={mine.slice(0, 12)}
                  onSeeAll={() => { setBrowseMode(true); setFilter('mine'); }}
                  installingId={installingId}
                  getItemTakopack={getItemTakopack}
                  onSelect={setSelectedItem}
                  onInstall={install}
                  onOpenRepo={openRepo}
                />
              )}
              {items.length === 0 && (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <div className="w-16 h-16 rounded-2xl bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center">
                    <Icons.Search className="w-7 h-7 text-zinc-400 opacity-60" />
                  </div>
                  <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">{t('noRepositoriesFound')}</p>
                </div>
              )}
            </>
          )}
        </div>
      )}

      </div>

      {isMobile && (
        <Modal
          isOpen={showMobileFilters}
          onClose={() => setShowMobileFilters(false)}
          title={t('filtersTitle')}
          size="lg"
        >
          <div className="space-y-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
                {t('categoryType')}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {FILTER_CHIPS.map((chip) => (
                  <button
                    key={chip.value}
                    type="button"
                    onClick={() => {
                      if (!isAuthenticated && (chip.value === 'mine' || chip.value === 'starred')) {
                        onRequireLogin();
                        return;
                      }
                      setFilter(chip.value);
                    }}
                    className={`min-h-[44px] rounded-xl text-xs font-medium transition-colors ${
                      filter === chip.value
                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                        : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}
                  >
                    {t(chip.labelKey as never)}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
                {t('categoryLabel')}
              </p>
              <div className="flex flex-wrap gap-2">
                {CATEGORY_CHIPS.map((chip) => (
                  <button
                    key={chip.value}
                    type="button"
                    onClick={() => setCategory(category === chip.value ? '' : chip.value)}
                    className={`min-h-[44px] px-3.5 rounded-xl text-xs font-medium transition-colors ${
                      category === chip.value
                        ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900'
                        : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                    }`}
                  >
                    {t(chip.labelKey as never)}
                  </button>
                ))}
              </div>
            </div>

            {filter !== 'mine' && (
              <button
                type="button"
                onClick={() => setInstallableOnly((v) => !v)}
                className={`w-full min-h-[44px] rounded-xl text-sm font-medium transition-colors ${
                  installableOnly
                    ? 'bg-emerald-600 text-white'
                    : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
                }`}
              >
                {t('installableOnly')}
              </button>
            )}

            <button
              type="button"
              className="w-full min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
              onClick={() => {
                setFilter('all');
                setCategory('');
                setInstallableOnly(false);
              }}
            >
              {t('resetFilters')}
            </button>
          </div>
        </Modal>
      )}

      {selectedItem && (
        <RepoDetailPanel
          item={selectedItem}
          takopack={getItemTakopack(selectedItem)}
          installingId={installingId}
          onClose={() => setSelectedItem(null)}
          onInstall={install}
          onUninstall={uninstall}
          onRollback={rollback}
          onStar={toggleStar}
          onOpenRepo={openRepo}
        />
      )}

      {showCreateModal && (
        <CreateRepoModal
          onClose={() => setShowCreateModal(false)}
          onCreate={createRepo}
        />
      )}
    </div>
  );
}
