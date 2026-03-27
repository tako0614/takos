import { useState } from 'react';
import { Icons } from '../../lib/Icons';
import { useI18n } from '../../store/i18n';
import { Modal } from '../../components/ui/Modal';
import type { SourceFilter, SourceSort } from '../../hooks/useSourceData';

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

/* ── Status bar (result count + clear filters) ── */

interface SourceFilterStatusBarProps {
  loading: boolean;
  total: number;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export function SourceFilterStatusBar({ loading, total, hasActiveFilters, onClearFilters }: SourceFilterStatusBarProps) {
  const { t } = useI18n();

  return (
    <div className="flex-shrink-0 px-4 pb-2 text-xs text-zinc-500 dark:text-zinc-400 flex items-center justify-between">
      <span>{loading ? t('searchingEllipsis') : t('resultsCount', { count: String(total) })}</span>
      {hasActiveFilters && (
        <button
          type="button"
          className="text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          onClick={onClearFilters}
        >
          {t('clearFilters')}
        </button>
      )}
    </div>
  );
}

/* ── Sort dropdown (shared between mobile & desktop) ── */

function SortDropdown({
  sort,
  setSort,
  sortOpen,
  setSortOpen,
  align = 'left',
  buttonClassName,
}: {
  sort: SourceSort;
  setSort: (v: SourceSort) => void;
  sortOpen: boolean;
  setSortOpen: (v: boolean) => void;
  align?: 'left' | 'right';
  buttonClassName?: string;
}) {
  const { t } = useI18n();
  const currentSortOpt = SORT_OPTIONS.find((o) => o.value === sort) ?? SORT_OPTIONS[0];

  return (
    <div className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setSortOpen(!sortOpen)}
        className={buttonClassName ?? "flex items-center gap-1 px-3 py-1.5 rounded-full bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"}
      >
        {t(currentSortOpt.labelKey as never)}
        <Icons.ChevronDown className="w-3 h-3" />
      </button>
      {sortOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
          <div className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-full mt-1 z-20 bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-100 dark:border-zinc-800 overflow-hidden min-w-[120px]`}>
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
  );
}

/* ── Desktop filter bar ── */

interface DesktopFilterBarProps {
  filter: SourceFilter;
  setFilter: (v: SourceFilter) => void;
  category: string;
  setCategory: (v: string) => void;
  installableOnly: boolean;
  setInstallableOnly: (v: boolean | ((prev: boolean) => boolean)) => void;
  sort: SourceSort;
  setSort: (v: SourceSort) => void;
  isAuthenticated: boolean;
  onRequireLogin: () => void;
}

export function DesktopFilterBar({
  filter, setFilter,
  category, setCategory,
  installableOnly, setInstallableOnly,
  sort, setSort,
  isAuthenticated, onRequireLogin,
}: DesktopFilterBarProps) {
  const { t } = useI18n();
  const [sortOpen, setSortOpen] = useState(false);

  return (
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
        <SortDropdown
          sort={sort}
          setSort={setSort}
          sortOpen={sortOpen}
          setSortOpen={setSortOpen}
          align="right"
          buttonClassName="flex items-center gap-1 px-3 py-1.5 rounded-full bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        />
      )}
    </div>
  );
}

/* ── Mobile filter bar (button + sort) ── */

interface MobileFilterBarProps {
  filter: SourceFilter;
  sort: SourceSort;
  setSort: (v: SourceSort) => void;
  hasActiveFilters: boolean;
  onShowFilters: () => void;
}

export function MobileFilterBar({
  filter, sort, setSort,
  hasActiveFilters, onShowFilters,
}: MobileFilterBarProps) {
  const { t } = useI18n();
  const [sortOpen, setSortOpen] = useState(false);

  return (
    <div className="flex-shrink-0 px-4 pb-3 flex items-center gap-2">
      <button
        type="button"
        className={`min-h-[44px] px-3.5 rounded-xl text-xs font-medium border transition-colors ${
          hasActiveFilters
            ? 'bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100'
            : 'bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700'
        }`}
        onClick={onShowFilters}
      >
        {t('filtersTitle')}
      </button>
      {filter !== 'mine' && (
        <SortDropdown
          sort={sort}
          setSort={setSort}
          sortOpen={sortOpen}
          setSortOpen={setSortOpen}
          align="left"
          buttonClassName="min-h-[44px] flex items-center gap-1 px-3.5 rounded-xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        />
      )}
    </div>
  );
}

/* ── Mobile filters modal ── */

interface MobileFiltersModalProps {
  isOpen: boolean;
  onClose: () => void;
  filter: SourceFilter;
  setFilter: (v: SourceFilter) => void;
  category: string;
  setCategory: (v: string) => void;
  installableOnly: boolean;
  setInstallableOnly: (v: boolean | ((prev: boolean) => boolean)) => void;
  isAuthenticated: boolean;
  onRequireLogin: () => void;
}

export function MobileFiltersModal({
  isOpen, onClose,
  filter, setFilter,
  category, setCategory,
  installableOnly, setInstallableOnly,
  isAuthenticated, onRequireLogin,
}: MobileFiltersModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
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
  );
}
