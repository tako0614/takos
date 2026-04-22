import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import type {
  CatalogSuggestionRepo,
  CatalogSuggestionUser,
} from "../../hooks/useSourceData.ts";

export type SuggestionUser = CatalogSuggestionUser;
export type SuggestionRepo = CatalogSuggestionRepo;

interface SourceSearchBarProps {
  searchRef: HTMLInputElement | null | undefined;
  query: string;
  setQuery: (q: string) => void;
  isSearchMode: boolean;
  searchFocused: boolean;
  setSearchFocused: (v: boolean) => void;
  suggesting: boolean;
  suggestions: { users: SuggestionUser[]; repos: SuggestionRepo[] };
  onExitSearch: () => void;
  onFocusSearch: () => void;
  onNavigateToRepo: (username: string, repoName: string) => void;
}

export function SourceSearchBar(props: SourceSearchBarProps) {
  const { t } = useI18n();

  return (
    <div class="relative">
      {props.isSearchMode
        ? (
          <button
            type="button"
            class="absolute left-3 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 transition-colors"
            onClick={props.onExitSearch}
            aria-label={t("goBack")}
          >
            <Icons.ChevronLeft class="w-5 h-5" />
          </button>
        )
        : (
          <Icons.Search class="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 pointer-events-none" />
        )}
      <input
        ref={props.searchRef as HTMLInputElement | undefined}
        type="text"
        value={props.query}
        onInput={(e) => props.setQuery(e.currentTarget.value)}
        onFocus={() => {
          props.setSearchFocused(true);
          props.onFocusSearch();
        }}
        onBlur={() => setTimeout(() => props.setSearchFocused(false), 150)}
        placeholder={t("searchReposAndPackages")}
        class="w-full h-12 md:h-11 pl-10 pr-10 rounded-2xl bg-white dark:bg-zinc-900 shadow-sm text-base md:text-sm text-zinc-900 dark:text-zinc-100 placeholder-zinc-400 dark:placeholder-zinc-500 border-none outline-none focus:ring-2 focus:ring-blue-400/30 dark:focus:ring-blue-500/30 transition-all"
      />
      {props.suggesting && (
        <Icons.Loader class="absolute right-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400 animate-spin" />
      )}
      {props.query && !props.suggesting && (
        <button
          type="button"
          class="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 text-zinc-400 hover:text-zinc-600 transition-colors"
          onClick={() => props.setQuery("")}
          aria-label={t("clear")}
        >
          <Icons.X class="w-4 h-4" />
        </button>
      )}

      {/* Suggestions dropdown */}
      {props.searchFocused && props.query.trim() &&
        (props.suggestions.users.length > 0 ||
          props.suggestions.repos.length > 0) &&
        (
          <div class="absolute z-20 left-0 right-0 mt-2 rounded-2xl bg-white dark:bg-zinc-900 shadow-xl border border-zinc-100 dark:border-zinc-800 overflow-hidden">
            {props.suggestions.users.length > 0 && (
              <div class="py-1">
                <p class="px-4 pt-2 pb-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                  {t("usersLabel")}
                </p>
                {props.suggestions.users.map((user) => (
                  <div
                    class="flex items-center gap-2 px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800 cursor-pointer"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => props.setQuery(`@${user.username}`)}
                  >
                    {user.avatar_url
                      ? (
                        <img
                          src={user.avatar_url}
                          alt=""
                          class="w-6 h-6 rounded-full"
                        />
                      )
                      : (
                        <div class="w-6 h-6 rounded-full bg-zinc-200 dark:bg-zinc-700 flex items-center justify-center text-[10px]">
                          {user.username.charAt(0).toUpperCase()}
                        </div>
                      )}
                    <span class="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                      @{user.username}
                    </span>
                    {user.name && (
                      <span class="text-xs text-zinc-400">{user.name}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            {props.suggestions.repos.length > 0 && (
              <div
                class={props.suggestions.users.length > 0
                  ? "border-t border-zinc-100 dark:border-zinc-800 py-1"
                  : "py-1"}
              >
                <p class="px-4 pt-2 pb-1 text-[10px] font-semibold text-zinc-400 uppercase tracking-wider">
                  {t("repositories")}
                </p>
                {props.suggestions.repos.map((repo) => (
                  <button
                    type="button"
                    class="w-full text-left px-4 py-2.5 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() =>
                      props.onNavigateToRepo(repo.owner.username, repo.name)}
                  >
                    <p class="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {repo.owner.username}/{repo.name}
                    </p>
                    {repo.description && (
                      <p class="text-xs text-zinc-400 truncate">
                        {repo.description}
                      </p>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
    </div>
  );
}
