import { createSignal, createEffect, onCleanup, type JSX } from 'solid-js';
import { Show, For } from 'solid-js';
import { useBreakpoint } from '../../hooks/useBreakpoint.ts';
import { useI18n } from '../../store/i18n.ts';
import { rpc, rpcJson } from '../../lib/rpc.ts';
import { Icons } from '../../lib/Icons.tsx';
import { Input } from '../../components/ui/Input.tsx';
import { Modal } from '../../components/ui/Modal.tsx';

type SpaceSearchResult = {
  kind: 'keyword' | 'semantic';
  score?: number;
  thread: { id: string; title: string | null; status: 'active' | 'archived' | 'deleted'; updated_at: string; created_at: string };
  message: { id: string; sequence: number; role: string; created_at: string };
  snippet: string;
  match?: { start: number; end: number } | null;
};

function renderSnippet(snippet: string, match?: { start: number; end: number } | null): JSX.Element {
  if (!match || match.start < 0 || match.end <= match.start || match.end > snippet.length) {
    return <span>{snippet}</span>;
  }
  return (
    <span>
      {snippet.slice(0, match.start)}
      <mark class="bg-yellow-200/70 dark:bg-yellow-600/40 rounded px-0.5">
        {snippet.slice(match.start, match.end)}
      </mark>
      {snippet.slice(match.end)}
    </span>
  );
}

function SearchResultsBody(props: {
  loading: boolean;
  error: string | null;
  query: string;
  results: SpaceSearchResult[];
  onSelectResult: (threadId: string, messageId: string, sequence: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Show when={!props.loading} fallback={
      <div class="flex items-center justify-center py-10 text-zinc-500 dark:text-zinc-400">
        <Icons.Loader class="w-6 h-6 animate-spin" />
      </div>
    }>
      <Show when={!props.error} fallback={
        <div class="py-4 text-sm text-red-600 dark:text-red-400">{props.error}</div>
      }>
        <Show when={props.query.trim()} fallback={
          <div class="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            {t('typeToSearch')}
          </div>
        }>
          <Show when={props.results.length > 0} fallback={
            <div class="py-10 text-center text-sm text-zinc-600 dark:text-zinc-400">
              {t('noResults')}
            </div>
          }>
            <div class="space-y-2">
              <For each={props.results}>{(r) => (
                <button
                  type="button"
                  class="w-full text-left p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100/50 dark:hover:bg-zinc-700/50 transition-colors"
                  onClick={() => {
                    props.onSelectResult(r.thread.id, r.message.id, r.message.sequence);
                    props.onClose();
                  }}
                >
                  <div class="flex items-center gap-2">
                    <span class="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                      {(r.kind === 'keyword' ? t('searchTypeKeyword') : t('searchTypeSemantic'))}
                      {typeof r.score === 'number' ? ` ${r.score.toFixed(2)}` : ''}
                    </span>
                    <span class="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                      {r.thread.title || t('untitled')}
                    </span>
                  </div>
                  <div class="mt-2 text-sm text-zinc-800 dark:text-zinc-200">
                    {renderSnippet(r.snippet, r.match)}
                  </div>
                </button>
              )}</For>
            </div>
          </Show>
        </Show>
      </Show>
    </Show>
  );
}

interface ChatSearchModalProps {
  spaceId: string;
  onSelectResult: (threadId: string, messageId: string, sequence: number) => void;
  onClose: () => void;
}

export function ChatSearchModal(props: ChatSearchModalProps) {
  const { t } = useI18n();
  const { isMobile } = useBreakpoint();
  const [query, setQuery] = createSignal('');
  const [searchType, setSearchType] = createSignal<'all' | 'keyword' | 'semantic'>('all');
  const [debouncedQuery, setDebouncedQuery] = createSignal('');
  createEffect(() => {
    const q = query();
    const timer = setTimeout(() => setDebouncedQuery(q), 250);
    onCleanup(() => clearTimeout(timer));
  });
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [results, setResults] = createSignal<SpaceSearchResult[]>([]);

  createEffect(() => {
    const q = debouncedQuery().trim();
    const type = searchType();
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
      param: { spaceId: props.spaceId },
      query: { q, type, limit: '20', offset: '0' },
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

    onCleanup(() => { cancelled = true; });
  });

  return (
    <Modal isOpen onClose={props.onClose} title={t('search')} size="lg">
      <div class="space-y-4">
        <div class="flex gap-2">
          <div class="flex-1">
            <Input
              autofocus={!isMobile}
              value={query()}
              onInput={(e: Event & { currentTarget: HTMLInputElement }) => setQuery(e.currentTarget.value)}
              placeholder={t('searchThreadsAndMessages')}
              leftIcon={<Icons.Search class="w-4 h-4" />}
              rightIcon={query().trim()
                ? (
                  <button
                    type="button"
                    class="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    onClick={() => setQuery('')}
                    aria-label={t('clear')}
                  >
                    <Icons.X class="w-4 h-4" />
                  </button>
                )
                : null}
            />
          </div>
          <select
            value={searchType()}
            onInput={(e) => {
              const v = e.currentTarget.value;
              setSearchType(v === 'keyword' || v === 'semantic' ? v : 'all');
            }}
            aria-label={t('search')}
            class="min-h-[44px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100"
          >
            <option value="all">{t('searchTypeAll')}</option>
            <option value="keyword">{t('searchTypeKeyword')}</option>
            <option value="semantic">{t('searchTypeSemantic')}</option>
          </select>
        </div>

        <div class="min-h-[200px]">
          <SearchResultsBody
            loading={loading()}
            error={error()}
            query={query()}
            results={results()}
            onSelectResult={props.onSelectResult}
            onClose={props.onClose}
          />
        </div>
      </div>
    </Modal>
  );
}
