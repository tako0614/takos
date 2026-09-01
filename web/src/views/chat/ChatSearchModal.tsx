import { createEffect, createSignal, type JSX, onCleanup } from "solid-js";
import { For, Show } from "solid-js";
import { useBreakpoint } from "../../hooks/useBreakpoint.ts";
import { useI18n } from "../../store/i18n.ts";
import { apiJson } from "../../lib/rpc.ts";
import { Icons } from "../../lib/Icons.tsx";
import { Input } from "../../components/ui/Input.tsx";
import { Modal } from "../../components/ui/Modal.tsx";
import {
  CHAT_SEARCH_QUERY_MAX_LENGTH,
  CHAT_SEARCH_RESULT_LIMIT,
  type ChatSearchResult,
  type ChatSearchType,
  parseChatSearchResponse,
} from "./chat-search-response.ts";

function renderSnippet(
  snippet: string,
  match?: { start: number; end: number } | null,
): JSX.Element {
  if (
    !match || match.start < 0 || match.end <= match.start ||
    match.end > snippet.length
  ) {
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
  searchType: ChatSearchType;
  semanticAvailable: boolean | null;
  results: ChatSearchResult[];
  onSelectResult: (
    threadId: string,
    messageId: string,
    sequence: number,
  ) => Promise<boolean>;
  onClose: () => void;
  onRetry: () => void;
}) {
  const { t } = useI18n();
  const [selecting, setSelecting] = createSignal<string | null>(null);
  return (
    <Show
      when={!props.loading}
      fallback={
        <div
          class="flex items-center justify-center py-10 text-zinc-500 dark:text-zinc-400"
          role="status"
        >
          <Icons.Loader class="w-6 h-6 animate-spin" />
          <span class="sr-only">{t("loading")}</span>
        </div>
      }
    >
      <Show
        when={!props.error}
        fallback={
          <div
            class="space-y-3 py-4 text-sm text-red-600 dark:text-red-400"
            role="alert"
          >
            <p>{props.error}</p>
            <button
              type="button"
              class="rounded-lg border border-red-300 px-3 py-2 font-medium hover:bg-red-50 dark:border-red-800 dark:hover:bg-red-950/30"
              onClick={props.onRetry}
            >
              {t("tryAgain")}
            </button>
          </div>
        }
      >
        <Show
          when={props.query.trim()}
          fallback={
            <div class="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
              {t("typeToSearch")}
            </div>
          }
        >
          <Show
            when={props.results.length > 0}
            fallback={
              <Show
                when={
                  props.searchType === "semantic" &&
                  props.semanticAvailable === false
                }
                fallback={
                  <div class="py-10 text-center text-sm text-zinc-600 dark:text-zinc-400">
                    {t("noResults")}
                  </div>
                }
              >
                <div
                  class="py-10 text-center text-sm text-zinc-600 dark:text-zinc-400"
                  role="status"
                >
                  {t("semanticSearchUnavailable")}
                </div>
              </Show>
            }
          >
            <div class="space-y-2">
              <For each={props.results}>
                {(r) => (
                  <button
                    type="button"
                    class="w-full text-left p-3 rounded-xl border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100/50 dark:hover:bg-zinc-700/50 transition-colors"
                    disabled={selecting() !== null}
                    aria-busy={
                      selecting() === `${r.thread.id}:${r.message.id}`
                    }
                    onClick={async () => {
                      if (selecting()) return;
                      const key = `${r.thread.id}:${r.message.id}`;
                      setSelecting(key);
                      try {
                        if (
                          await props.onSelectResult(
                            r.thread.id,
                            r.message.id,
                            r.message.sequence,
                          )
                        ) {
                          props.onClose();
                        }
                      } finally {
                        setSelecting(null);
                      }
                    }}
                  >
                    <div class="flex items-center gap-2">
                      <span class="text-xs px-2 py-0.5 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300">
                        {r.kind === "keyword"
                          ? t("searchTypeKeyword")
                          : t("searchTypeSemantic")}
                        {typeof r.score === "number"
                          ? ` ${r.score.toFixed(2)}`
                          : ""}
                      </span>
                      <span class="text-xs text-zinc-500 dark:text-zinc-400 truncate">
                        {r.thread.title || t("untitled")}
                      </span>
                    </div>
                    <div class="mt-2 text-sm text-zinc-800 dark:text-zinc-200">
                      {renderSnippet(r.snippet, r.match)}
                    </div>
                  </button>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
    </Show>
  );
}

interface ChatSearchModalProps {
  spaceId: string;
  onSelectResult: (
    threadId: string,
    messageId: string,
    sequence: number,
  ) => Promise<boolean>;
  onClose: () => void;
}

export function ChatSearchModal(props: ChatSearchModalProps) {
  const { t } = useI18n();
  const breakpoint = useBreakpoint();
  const [query, setQuery] = createSignal("");
  const [searchType, setSearchType] = createSignal<ChatSearchType>("all");
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [results, setResults] = createSignal<ChatSearchResult[]>([]);
  const [semanticAvailable, setSemanticAvailable] = createSignal<
    boolean | null
  >(null);
  const [retryVersion, setRetryVersion] = createSignal(0);
  let requestVersion = 0;

  createEffect(() => {
    retryVersion();
    const q = query().trim();
    const type = searchType();
    const version = ++requestVersion;
    if (!q) {
      setResults([]);
      setError(null);
      setLoading(false);
      setSemanticAvailable(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);
    setResults([]);
    setSemanticAvailable(null);
    const timer = globalThis.setTimeout(() => {
      const params = new URLSearchParams({
        q,
        type,
        limit: String(CHAT_SEARCH_RESULT_LIMIT),
        offset: "0",
      });
      void apiJson<unknown>(
        `/api/spaces/${encodeURIComponent(props.spaceId)}/threads/search?${
          params.toString()
        }`,
        { init: { credentials: "include", signal: controller.signal } },
      )
        .then((value) => parseChatSearchResponse(value, { query: q, type }))
        .then((data) => {
          if (version !== requestVersion) return;
          setResults(data.results);
          setSemanticAvailable(data.semanticAvailable);
        })
        .catch((err: unknown) => {
          if (version !== requestVersion) return;
          setError(
            err instanceof TypeError
              ? t("searchFailed")
              : err instanceof Error
              ? err.message
              : t("searchFailed"),
          );
          setResults([]);
        })
        .finally(() => {
          if (version === requestVersion) setLoading(false);
        });
    }, 250);

    onCleanup(() => {
      globalThis.clearTimeout(timer);
      if (version === requestVersion) requestVersion += 1;
      controller.abort();
    });
  });

  return (
    <Modal isOpen onClose={props.onClose} title={t("search")} size="lg">
      <div class="space-y-4">
        <div class="flex gap-2">
          <div class="flex-1">
            <Input
              autofocus={!breakpoint.isMobile}
              name="chat-search-query"
              aria-label={t("searchThreadsAndMessages")}
              maxLength={CHAT_SEARCH_QUERY_MAX_LENGTH}
              value={query()}
              onInput={(e: Event & { currentTarget: HTMLInputElement }) =>
                setQuery(e.currentTarget.value)}
              placeholder={t("searchThreadsAndMessages")}
              leftIcon={<Icons.Search class="w-4 h-4" />}
              rightIcon={query().trim()
                ? (
                  <button
                    type="button"
                    class="w-5 h-5 flex items-center justify-center text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
                    onClick={() => setQuery("")}
                    aria-label={t("clear")}
                  >
                    <Icons.X class="w-4 h-4" />
                  </button>
                )
                : null}
            />
          </div>
          <select
            name="chat-search-type"
            value={searchType()}
            onInput={(e) => {
              const v = e.currentTarget.value;
              setSearchType(v === "keyword" || v === "semantic" ? v : "all");
            }}
            aria-label={t("search")}
            class="min-h-[44px] px-3 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-sm text-zinc-900 dark:text-zinc-100"
          >
            <option value="all">{t("searchTypeAll")}</option>
            <option value="keyword">{t("searchTypeKeyword")}</option>
            <option value="semantic">{t("searchTypeSemantic")}</option>
          </select>
        </div>

        <div class="min-h-[200px]">
          <SearchResultsBody
            loading={loading()}
            error={error()}
            query={query()}
            searchType={searchType()}
            semanticAvailable={semanticAvailable()}
            results={results()}
            onSelectResult={props.onSelectResult}
            onClose={props.onClose}
            onRetry={() => setRetryVersion((current) => current + 1)}
          />
        </div>
      </div>
    </Modal>
  );
}
