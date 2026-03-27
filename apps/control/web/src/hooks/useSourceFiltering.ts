import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../providers/I18nProvider';
import { rpc, rpcJson } from '../lib/rpc';
import { getPersonalSpace, getSpaceIdentifier } from '../lib/spaces';
import type { Space } from '../types';

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
  installableOnly: boolean;
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
      installableOnly: typeof parsed.installableOnly === 'boolean' ? parsed.installableOnly : undefined,
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
  filter: SourceFilter;
  setFilter: React.Dispatch<React.SetStateAction<SourceFilter>>;
  sort: SourceSort;
  setSort: React.Dispatch<React.SetStateAction<SourceSort>>;
  category: string;
  setCategory: React.Dispatch<React.SetStateAction<string>>;
  installableOnly: boolean;
  setInstallableOnly: React.Dispatch<React.SetStateAction<boolean>>;
  query: string;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  debouncedQuery: string;
  selectedSpaceId: string | null;
  effectiveSpaceId: string | null;
  setSelectedSpaceId: React.Dispatch<React.SetStateAction<string | null>>;
  searchFocused: boolean;
  setSearchFocused: React.Dispatch<React.SetStateAction<boolean>>;
  suggestions: CatalogSuggestions;
  suggesting: boolean;
}

export function useSourceFiltering({
  spaces,
  isAuthenticated,
}: UseSourceFilteringOptions): UseSourceFilteringResult {
  const { t } = useI18n();
  const persistedState = useState(() => readPersistedSourceState())[0];

  const [filter, setFilter] = useState<SourceFilter>(persistedState.filter ?? 'all');
  const [sort, setSort] = useState<SourceSort>(persistedState.sort ?? 'trending');
  const [category, setCategory] = useState(persistedState.category ?? '');
  const [installableOnly, setInstallableOnly] = useState(persistedState.installableOnly ?? false);
  const [query, setQuery] = useState(persistedState.query ?? '');
  const [debouncedQuery, setDebouncedQuery] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(
    persistedState.selectedSpaceId ?? null,
  );
  const spaceIds = useMemo(
    () => new Set(spaces.map((space) => getSpaceIdentifier(space))),
    [spaces],
  );
  const effectiveSpaceId = isAuthenticated
    && selectedSpaceId
    && spaceIds.has(selectedSpaceId)
    ? selectedSpaceId
    : null;

  const [searchFocused, setSearchFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<CatalogSuggestions>({ users: [], repos: [] });
  const [suggesting, setSuggesting] = useState(false);
  const suggestionRequestSeqRef = useState(() => ({ current: 0 }))[0];

  // Initialize space and validate persisted space selection against current auth/spaces.
  useEffect(() => {
    if (!isAuthenticated) {
      if (selectedSpaceId !== null) {
        setSelectedSpaceId(null);
      }
      return;
    }
    if (spaces.length === 0) return;

    if (selectedSpaceId && spaceIds.has(selectedSpaceId)) {
      return;
    }

    const personal = getPersonalSpace(spaces, t('personal'));
    setSelectedSpaceId(
      personal ? getSpaceIdentifier(personal) : getSpaceIdentifier(spaces[0]),
    );
  }, [isAuthenticated, spaces, selectedSpaceId, spaceIds, t]);

  useEffect(() => {
    writePersistedSourceState({
      filter,
      sort,
      category,
      installableOnly,
      query,
      selectedSpaceId: effectiveSpaceId,
    });
  }, [category, effectiveSpaceId, filter, installableOnly, query, sort]);

  // Search suggestions
  useEffect(() => {
    const q = query.trim();
    if (!q || !searchFocused) {
      setSuggestions({ users: [], repos: [] });
      setSuggesting(false);
      suggestionRequestSeqRef.current += 1;
      return;
    }
    const currentRequestId = suggestionRequestSeqRef.current + 1;
    suggestionRequestSeqRef.current = currentRequestId;
    const timer = setTimeout(async () => {
      try {
        setSuggesting(true);
        const response = await rpc.explore.catalog.suggest.$get({ query: { q, limit: '6' } });
        const data = await rpcJson<CatalogSuggestions>(response);
        if (currentRequestId !== suggestionRequestSeqRef.current) return;
        setSuggestions({ users: data.users || [], repos: data.repos || [] });
      } catch {
        if (currentRequestId !== suggestionRequestSeqRef.current) return;
        setSuggestions({ users: [], repos: [] });
      } finally {
        if (currentRequestId === suggestionRequestSeqRef.current) {
          setSuggesting(false);
        }
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      if (currentRequestId === suggestionRequestSeqRef.current) {
        suggestionRequestSeqRef.current += 1;
      }
    };
  }, [query, searchFocused]);

  return {
    filter,
    setFilter,
    sort,
    setSort,
    category,
    setCategory,
    installableOnly,
    setInstallableOnly,
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
