import { createSignal } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { Modal } from "../../components/ui/Modal.tsx";
import type { TranslationKey } from "../../store/i18n.ts";
import type { SourceFilter, SourceSort } from "../../hooks/useSourceData.ts";

const FILTER_CHIPS: Array<{ value: SourceFilter; labelKey: TranslationKey }> = [
  { value: "all", labelKey: "sourceFilterAll" },
  { value: "mine", labelKey: "sourceFilterMine" },
  { value: "starred", labelKey: "sourceFilterStarred" },
];

const CATEGORY_CHIPS: Array<{ value: string; labelKey: TranslationKey }> = [
  { value: "app", labelKey: "categoryApps" },
  { value: "service", labelKey: "categoryServices" },
  { value: "library", labelKey: "categoryLibraries" },
  { value: "template", labelKey: "categoryTemplates" },
  { value: "social", labelKey: "categorySocial" },
];

const SORT_OPTIONS: Array<{ value: SourceSort; labelKey: TranslationKey }> = [
  { value: "trending", labelKey: "sortTrending" },
  { value: "new", labelKey: "sortNew" },
  { value: "stars", labelKey: "sortStars" },
  { value: "updated", labelKey: "sortUpdated" },
];

/* ── Status bar (result count + clear filters) ── */

interface SourceFilterStatusBarProps {
  loading: boolean;
  total: number;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}

export function SourceFilterStatusBar(props: SourceFilterStatusBarProps) {
  const { t } = useI18n();

  return (
    <div class="flex-shrink-0 px-4 pb-2 text-xs text-zinc-500 dark:text-zinc-400 flex items-center justify-between">
      <span>
        {props.loading
          ? t("searchingEllipsis")
          : t("resultsCount", { count: String(props.total) })}
      </span>
      {props.hasActiveFilters && (
        <button
          type="button"
          class="text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
          onClick={props.onClearFilters}
        >
          {t("clearFilters")}
        </button>
      )}
    </div>
  );
}

/* ── Sort dropdown (shared between mobile & desktop) ── */

function SortDropdown(props: {
  sort: SourceSort;
  setSort: (v: SourceSort) => void;
  sortOpen: boolean;
  setSortOpen: (v: boolean) => void;
  align?: "left" | "right";
  buttonClassName?: string;
}) {
  const { t } = useI18n();
  const currentSortOpt = SORT_OPTIONS.find((o) => o.value === props.sort) ??
    SORT_OPTIONS[0];

  return (
    <div class="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => props.setSortOpen(!props.sortOpen)}
        class={props.buttonClassName ??
          "flex items-center gap-1 px-3 py-1.5 rounded-full bg-white dark:bg-zinc-900 text-xs font-medium text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"}
      >
        {t(currentSortOpt.labelKey)}
        <Icons.ChevronDown class="w-3 h-3" />
      </button>
      {props.sortOpen && (
        <>
          <div
            class="fixed inset-0 z-10"
            onClick={() => props.setSortOpen(false)}
          />
          <div
            class={`absolute ${
              props.align === "right" ? "right-0" : "left-0"
            } top-full mt-1 z-20 bg-white dark:bg-zinc-900 rounded-xl shadow-lg border border-zinc-100 dark:border-zinc-800 overflow-hidden min-w-[120px]`}
          >
            {SORT_OPTIONS.map((opt) => (
              <button
                type="button"
                onClick={() => {
                  props.setSort(opt.value);
                  props.setSortOpen(false);
                }}
                class={`w-full text-left px-4 py-2.5 text-xs transition-colors ${
                  props.sort === opt.value
                    ? "text-zinc-900 dark:text-zinc-100 font-semibold"
                    : "text-zinc-600 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                }`}
              >
                {t(opt.labelKey)}
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
  sort: SourceSort;
  setSort: (v: SourceSort) => void;
  isAuthenticated: boolean;
  onRequireLogin: () => void;
}

export function DesktopFilterBar(props: DesktopFilterBarProps) {
  const { t } = useI18n();
  const [sortOpen, setSortOpen] = createSignal(false);

  return (
    <div class="flex-shrink-0 flex items-center gap-1.5 px-4 pb-3 overflow-x-auto scrollbar-none">
      {FILTER_CHIPS.map((chip) => (
        <button
          type="button"
          onClick={() => {
            if (
              !props.isAuthenticated &&
              (chip.value === "mine" || chip.value === "starred")
            ) {
              props.onRequireLogin();
              return;
            }
            props.setFilter(chip.value);
          }}
          class={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
            props.filter === chip.value
              ? "bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900"
              : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          {t(chip.labelKey)}
        </button>
      ))}

      <div class="w-px h-4 bg-zinc-200 dark:bg-zinc-700 flex-shrink-0 mx-0.5" />

      {CATEGORY_CHIPS.map((chip) => (
        <button
          type="button"
          onClick={() =>
            props.setCategory(props.category === chip.value ? "" : chip.value)}
          class={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-xs font-medium transition-colors ${
            props.category === chip.value
              ? "bg-zinc-900 dark:bg-zinc-50 text-white dark:text-zinc-900"
              : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          }`}
        >
          {t(chip.labelKey)}
        </button>
      ))}

      {props.filter !== "mine" && (
        <SortDropdown
          sort={props.sort}
          setSort={props.setSort}
          sortOpen={sortOpen()}
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

export function MobileFilterBar(props: MobileFilterBarProps) {
  const { t } = useI18n();
  const [sortOpen, setSortOpen] = createSignal(false);

  return (
    <div class="flex-shrink-0 px-4 pb-3 flex items-center gap-2">
      <button
        type="button"
        class={`min-h-[44px] px-3.5 rounded-xl text-xs font-medium border transition-colors ${
          props.hasActiveFilters
            ? "bg-zinc-900 text-white border-zinc-900 dark:bg-zinc-100 dark:text-zinc-900 dark:border-zinc-100"
            : "bg-white dark:bg-zinc-900 text-zinc-600 dark:text-zinc-300 border-zinc-200 dark:border-zinc-700"
        }`}
        onClick={props.onShowFilters}
      >
        {t("filtersTitle")}
      </button>
      {props.filter !== "mine" && (
        <SortDropdown
          sort={props.sort}
          setSort={props.setSort}
          sortOpen={sortOpen()}
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
  isAuthenticated: boolean;
  onRequireLogin: () => void;
}

export function MobileFiltersModal(props: MobileFiltersModalProps) {
  const { t } = useI18n();

  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={t("filtersTitle")}
      size="lg"
    >
      <div class="space-y-5">
        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
            {t("categoryType")}
          </p>
          <div class="grid grid-cols-3 gap-2">
            {FILTER_CHIPS.map((chip) => (
              <button
                type="button"
                onClick={() => {
                  if (
                    !props.isAuthenticated &&
                    (chip.value === "mine" || chip.value === "starred")
                  ) {
                    props.onRequireLogin();
                    return;
                  }
                  props.setFilter(chip.value);
                }}
                class={`min-h-[44px] rounded-xl text-xs font-medium transition-colors ${
                  props.filter === chip.value
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                {t(chip.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p class="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 mb-2">
            {t("categoryLabel")}
          </p>
          <div class="flex flex-wrap gap-2">
            {CATEGORY_CHIPS.map((chip) => (
              <button
                type="button"
                onClick={() =>
                  props.setCategory(
                    props.category === chip.value ? "" : chip.value,
                  )}
                class={`min-h-[44px] px-3.5 rounded-xl text-xs font-medium transition-colors ${
                  props.category === chip.value
                    ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
                }`}
              >
                {t(chip.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          class="w-full min-h-[44px] rounded-xl border border-zinc-200 dark:border-zinc-700 text-sm text-zinc-700 dark:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
          onClick={() => {
            props.setFilter("all");
            props.setCategory("");
          }}
        >
          {t("resetFilters")}
        </button>
      </div>
    </Modal>
  );
}
