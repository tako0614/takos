import { useEffect, useState, type ReactNode } from 'react';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { useI18n } from '../../providers/I18nProvider';
import { rpc, rpcJson } from '../../lib/rpc';
import { Icons } from '../../lib/Icons';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';

type SpaceSearchResult = {
  kind: 'keyword' | 'semantic';
  score?: number;
  thread: { id: string; title: string | null; status: 'active' | 'archived' | 'deleted'; updated_at: string; created_at: string };
  message: { id: string; sequence: number; role: string; created_at: string };
  snippet: string;
  match?: { start: number; end: number } | null;
};

function renderSnippet(snippet: string, match?: { start: number; end: number } | null): ReactNode {
  if (!match || match.start < 0 || match.end <= match.start || match.end > snippet.length) {
    return <span>{snippet}</span>;
  }
  return (
    <span>
      {snippet.slice(0, match.start)}
      <mark className="bg-yellow-200/70 dark:bg-yellow-600/40 rounded px-0.5">
        {snippet.slice(match.start, match.end)}
      </mark>
      {snippet.slice(match.end)}
    </span>
  );
}

function SearchResultsBody({
  loading,
  error,
  query,
  results,
  onSelectResult,
  onClose,
}: {
  loading: boolean;
  error: string | null;
  query: string;
  results: SpaceSearchResult[];
  onSelectResult: (threadId: string, messageId: string, sequence: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  if (loading) {
    return (
      <div className="flex items-center justify-center py-10 text-zinc-500 dark:text-zinc-400">
        <Icons.Loader className="w-6 h-6 animate-spin" />
      </div>
    );
  }
  if (error) {
    return <div className="py-4 text-sm text-red-600 dark:text-red-400">{error}</div>;
  }
  if (!query.trim()) {
    return (
      <div className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {t('typeToSearch')}
      </div>
    );
  }
  if (results.length === 0) {
    return (
      <div className="py-10 text-center text-sm text-zinc-600 dark:text-zinc-400">
        {t('noResults')}
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {results.map((r) => (
        <button
          key={`${r.kind}-${r.message.id}`}
          type="button"
          className="w-full text-left p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100/50 dark:hover:bg-zinc-700/50 transition-colors"
          onClick={() => {
            onSelectResult(r.thread.id, r.message.id, r.message.sequence);
            onClose();
          }}
        >
          <div className="flex items-center gap-2">
            <span className="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
              {(r.kind === 'keyword' ? t('searchTypeKeyword') : t('searchTypeSemantic'))}
              {typeof r.score === 'number' ? ` ${r.score.toFixed(2)}` : ''}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">
              {r.thread.title || t('untitled')}
            </span>
          </div>
          <div className="mt-2 text-sm text-zinc-800 dark:text-zinc-200">
            {renderSnippet(r.snippet, r.match)}
          </div>
        </button>
      ))}
    </div>
  );
}

interface ChatSearchModalProps {
  spaceId: string;
  onSelectResult: (threadId: string, messageId: string, sequence: number) => void;
  onClose: () => void;
}

export function ChatSearchModal({ spaceId, onSelectResult, onClose }: ChatSearchModalProps) {
  const { t } = useI18n();
  const { isMobile } = useBreakpoint();
  const [query, setQuery] = useState('');
  const [searchType, setSearchType] = useState<'all' | 'keyword' | 'semantic'>('all');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SpaceSearchResult[]>([]);

  useEffect(() => {
    const q = debouncedQuery.trim();
    if (!q) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    rpc.spaces[':spaceId'].threads.search.$get({
      param: { spaceId },
      query: { q, type: searchType, limit: '20', offset: '0' },
    })
      .then(async (res) => {
        if (cancelled) return;
        const data = await rpcJson<{ results: SpaceSearchResult[] }>(res);
        setResults(data.results || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : t('searchFailed'));
        setResults([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [debouncedQuery, spaceId, searchType, t]);

  return (
    <Modal isOpen onClose={onClose} title={t('search')} size="lg">
      <div className="space-y-4">
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              autoFocus={!isMobile}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('searchThreadsAndMessages')}
              leftIcon={<Icons.Search className="w-4 h-4" />}
              rightIcon={query.trim()
                ? (
                  <button
                    type="button"
                    className="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    onClick={() => setQuery('')}
                    aria-label={t('clear')}
                  >
                    <Icons.X className="w-4 h-4" />
                  </button>
                )
                : null}
            />
          </div>
          <select
            value={searchType}
            onChange={(e) => {
              const v = e.target.value;
              setSearchType(v === 'keyword' || v === 'semantic' ? v : 'all');
            }}
            aria-label={t('search')}
            className="min-h-[44px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100"
          >
            <option value="all">{t('searchTypeAll')}</option>
            <option value="keyword">{t('searchTypeKeyword')}</option>
            <option value="semantic">{t('searchTypeSemantic')}</option>
          </select>
        </div>

        <div className="min-h-[200px]">
          <SearchResultsBody
            loading={loading}
            error={error}
            query={query}
            results={results}
            onSelectResult={onSelectResult}
            onClose={onClose}
          />
        </div>
      </div>
    </Modal>
  );
}
