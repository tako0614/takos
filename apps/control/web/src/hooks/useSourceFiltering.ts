import { createSignal, createEffect, createMemo, on, onCleanup } from 'solid-js';
import type { Accessor, Setter } from 'solid-js';
import { useI18n } from '../store/i18n.ts';
import { rpc, rpcJson } from '../lib/rpc.ts';
import { getPersonalSpace, getSpaceIdentifier } from '../lib/spaces.ts';
import type { Space } from '../types/index.ts';

export type SourceFilter = 'all' | 'mine' | 'starred';
export type SourceSort = 'trending' | 'new' | 'stars' | 'updated';

export interface CatalogSuggestionUser {
  username: string;
  name: string | null;
  avatar_url: string | null;
}

export interface CatalogSuggestionRepo {
  id: string;
  name: string;
  description: string | null;
  stars: number;
  updated_at: string;
  owner: {
    username: string;
    name: string | null;
    avatar_url: string | null;
  };
}

interface CatalogSuggestions {
  users: CatalogSuggestionUser[];
  repos: CatalogSuggestionRepo[];
}

const SOURCE_STATE_KEY = 'takos.source.state.v1';

type PersistedSourceState = {
  filter: SourceFilter;
  sort: SourceSort;
  category: string;
  officialOnly: boolean;
  query: string;
  selectedSpaceId: string | null;
};

const ALLOWED_FILTERS: SourceFilter[] = ['all', 'mine', 'starred'];
const ALLOWED_SORTS: SourceSort[] = ['trending', 'new', 'stars', 'updated'];

function readPersistedSourceState(): Partial<PersistedSourceState> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(SOURCE_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<PersistedSourceState>;
    return {
      filter: ALLOWED_FILTERS.includes(parsed.filter as SourceFilter) ? parsed.filter : undefined,
      sort: ALLOWED_SORTS.includes(parsed.sort as SourceSort) ? parsed.sort : undefined,
      category: typeof parsed.category === 'string' ? parsed.category : undefined,
      officialOnly: typeof parsed.officialOnly === 'boolean' ? parsed.officialOnly : undefined,
      query: typeof parsed.query === 'string' ? parsed.query : undefined,
      selectedSpaceId: typeof parsed.selectedSpaceId === 'string'
        ? parsed.selectedSpaceId
        : parsed.selectedSpaceId === null
          ? null
          : undefined,
    };
  } catch {
    return {};
  }
}

function writePersistedSourceState(state: PersistedSourceState) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(SOURCE_STATE_KEY, JSON.stringify(state));
  } catch {
    // noop
  }
}

export interface UseSourceFilteringOptions {
  spaces: Space[];
  isAuthenticated: boolean;
}

export interface UseSourceFilteringResult {
  filter: Accessor<SourceFilter>;
  setFilter: Setter<SourceFilter>;
  sort: Accessor<SourceSort>;
  setSort: Setter<SourceSort>;
  category: Accessor<string>;
  setCategory: Setter<string>;
  officialOnly: Accessor<boolean>;
  setOfficialOnly: Setter<boolean>;
  query: Accessor<string>;
  setQuery: Setter<string>;
  debouncedQuery: Accessor<string>;
  selectedSpaceId: Accessor<string | null>;
  effectiveSpaceId: Accessor<string | null>;
  setSelectedSpaceId: Setter<string | null>;
  searchFocused: Accessor<boolean>;
  setSearchFocused: Setter<boolean>;
  suggestions: Accessor<CatalogSuggestions>;
  suggesting: Accessor<boolean>;
}

export function useSourceFiltering({
  spaces,
  isAuthenticated,
}: UseSourceFilteringOptions): UseSourceFilteringResult {
  const { t } = useI18n();
  const persistedState = readPersistedSourceState();

  const [filter, setFilter] = createSignal<SourceFilter>(persistedState.filter ?? 'all');
  const [sort, setSort] = createSignal<SourceSort>(persistedState.sort ?? 'trending');
  const [category, setCategory] = createSignal(persistedState.category ?? '');
  const [officialOnly, setOfficialOnly] = createSignal(persistedState.officialOnly ?? false);
  const [query, setQuery] = createSignal(persistedState.query ?? '');
  const [debouncedQuery, setDebouncedQuery] = createSignal(query());

  createEffect(() => {
    const currentQuery = query();
    const timer = setTimeout(() => setDebouncedQuery(currentQuery), 250);
    onCleanup(() => clearTimeout(timer));
  });

  const [selectedSpaceId, setSelectedSpaceId] = createSignal<string | null>(
    persistedState.selectedSpaceId ?? null,
  );
  const spaceIds = createMemo(
    () => new Set(spaces.map((space) => getSpaceIdentifier(space))),
  );
  const effectiveSpaceId = createMemo(() => {
    return isAuthenticated
      && selectedSpaceId()
      && spaceIds().has(selectedSpaceId()!)
      ? selectedSpaceId()
      : null;
  });

  const [searchFocused, setSearchFocused] = createSignal(false);
  const [suggestions, setSuggestions] = createSignal<CatalogSuggestions>({ users: [], repos: [] });
  const [suggesting, setSuggesting] = createSignal(false);
  let suggestionRequestSeq = 0;

  // Initialize space and validate persisted space selection against current auth/spaces.
  createEffect(() => {
    if (!isAuthenticated) {
      if (selectedSpaceId() !== null) {
        setSelectedSpaceId(null);
      }
      return;
    }
    if (spaces.length === 0) return;

    if (selectedSpaceId() && spaceIds().has(selectedSpaceId()!)) {
      return;
    }

    const personal = getPersonalSpace(spaces, t('personal'));
    setSelectedSpaceId(
      personal ? getSpaceIdentifier(personal) : getSpaceIdentifier(spaces[0]),
    );
  });

  createEffect(() => {
    writePersistedSourceState({
      filter: filter(),
      sort: sort(),
      category: category(),
      officialOnly: officialOnly(),
      query: query(),
      selectedSpaceId: effectiveSpaceId(),
    });
  });

  // Search suggestions
  createEffect(() => {
    const q = query().trim();
    const focused = searchFocused();
    if (!q || !focused) {
      setSuggestions({ users: [], repos: [] });
      setSuggesting(false);
      suggestionRequestSeq += 1;
      return;
    }
    const currentRequestId = suggestionRequestSeq + 1;
    suggestionRequestSeq = currentRequestId;
    const timer = setTimeout(async () => {
      try {
        setSuggesting(true);
        const response = await rpc.explore.catalog.suggest.$get({ query: { q, limit: '6' } });
        const data = await rpcJson<CatalogSuggestions>(response);
        if (currentRequestId !== suggestionRequestSeq) return;
        setSuggestions({ users: data.users || [], repos: data.repos || [] });
      } catch {
        if (currentRequestId !== suggestionRequestSeq) return;
        setSuggestions({ users: [], repos: [] });
      } finally {
        if (currentRequestId === suggestionRequestSeq) {
          setSuggesting(false);
        }
      }
    }, 180);
    onCleanup(() => {
      clearTimeout(timer);
      if (currentRequestId === suggestionRequestSeq) {
        suggestionRequestSeq += 1;
      }
    });
  });

  return {
    filter,
    setFilter,
    sort,
    setSort,
    category,
    setCategory,
    officialOnly,
    setOfficialOnly,
    query,
    setQuery,
    debouncedQuery,
    selectedSpaceId,
    effectiveSpaceId,
    setSelectedSpaceId,
    searchFocused,
    setSearchFocused,
    suggestions,
    suggesting,
  };
}
