import { createEffect, createSignal, For, on, Show } from "solid-js";
import { Icons } from "../../../lib/Icons.tsx";
import type { Commit } from "../../../types/index.ts";
import { formatDetailedRelativeDate } from "../../../lib/format.ts";
import { rpc, rpcJson } from "../../../lib/rpc.ts";
import { useI18n } from "../../../store/i18n.ts";

interface CommitListProps {
  repoId: string;
  branch: string;
}

export function CommitList(props: CommitListProps) {
  const { t } = useI18n();
  const [commits, setCommits] = createSignal<Commit[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [hasMore, setHasMore] = createSignal(true);
  const [page, setPage] = createSignal(1);
  let commitsSeq = 0;

  const fetchCommits = async (pageNum: number) => {
    const repoId = props.repoId;
    const branch = props.branch;
    const seq = ++commitsSeq;
    try {
      setLoading(true);
      const res = await rpc.repos[":repoId"].commits.$get({
        param: { repoId },
        query: { branch, page: String(pageNum), limit: "20" },
      });
      const data = await rpcJson<{ commits?: Commit[] }>(res);
      if (
        seq !== commitsSeq || repoId !== props.repoId ||
        branch !== props.branch
      ) {
        return;
      }
      const newCommits = data.commits || [];

      if (pageNum === 1) {
        setCommits(newCommits);
      } else {
        setCommits((prev) => [...prev, ...newCommits]);
      }

      setHasMore(newCommits.length === 20);
    } catch (err) {
      if (
        seq !== commitsSeq || repoId !== props.repoId ||
        branch !== props.branch
      ) {
        return;
      }
      setError(err instanceof Error ? err.message : t("unknownError"));
    } finally {
      if (
        seq === commitsSeq && repoId === props.repoId &&
        branch === props.branch
      ) {
        setLoading(false);
      }
    }
  };

  createEffect(on(
    () => [props.repoId, props.branch],
    () => {
      setCommits([]);
      setPage(1);
      setHasMore(true);
      fetchCommits(1);
    },
  ));

  const loadMore = () => {
    const nextPage = page() + 1;
    setPage(nextPage);
    fetchCommits(nextPage);
  };

  const groupCommitsByDate = (commitList: Commit[]): Map<string, Commit[]> => {
    const groups = new Map<string, Commit[]>();

    for (const commit of commitList) {
      const date = new Date(commit.date);
      const dateKey = date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      });

      if (!groups.has(dateKey)) {
        groups.set(dateKey, []);
      }
      groups.get(dateKey)!.push(commit);
    }

    return groups;
  };

  const copyCommitSha = async (sha: string) => {
    try {
      await navigator.clipboard.writeText(sha);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const groupedCommits = () => groupCommitsByDate(commits());

  return (
    <>
      <Show when={loading() && commits().length === 0}>
        <div class="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500">
          <div class="w-8 h-8 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
          <span>{t("loadingCommits")}</span>
        </div>
      </Show>

      <Show when={error()}>
        <div class="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500">
          <Icons.AlertTriangle class="w-12 h-12 text-zinc-700" />
          <span>{error()}</span>
          <button
            type="button"
            class="px-4 py-2 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            onClick={() => fetchCommits(1)}
          >
            {t("retry")}
          </button>
        </div>
      </Show>

      <Show when={!error() && !(loading() && commits().length === 0)}>
        <div class="flex flex-col bg-white dark:bg-zinc-900">
          <div class="flex items-center gap-2 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800">
            <Icons.Clock class="w-4 h-4 text-zinc-500" />
            <span class="text-sm text-zinc-500 dark:text-zinc-400">
              {t("commitsOnBranch", {
                count: commits().length,
                branch: props.branch,
              })}
            </span>
          </div>

          <Show when={commits().length === 0}>
            <div class="flex flex-col items-center justify-center gap-4 py-12 text-zinc-500">
              <Icons.Clock class="w-12 h-12" />
              <p>{t("noCommitsFound")}</p>
            </div>
          </Show>

          <Show when={commits().length > 0}>
            <div class="flex flex-col">
              <For each={Array.from(groupedCommits().entries())}>
                {([dateKey, dateCommits]) => (
                  <div class="flex flex-col">
                    <div class="px-4 py-2 text-sm font-medium text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 border-b border-zinc-200 dark:border-zinc-700">
                      <span>{dateKey}</span>
                    </div>
                    <div class="flex flex-col">
                      <For each={dateCommits}>
                        {(commit) => (
                          <div class="flex items-start gap-3 px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 hover:bg-zinc-50 dark:hover:bg-zinc-800 transition-colors">
                            <div class="flex-shrink-0 mt-0.5">
                              {commit.author.avatar_url
                                ? (
                                  <img
                                    src={commit.author.avatar_url}
                                    alt={commit.author.name + "'s avatar"}
                                    class="w-8 h-8 rounded-full"
                                  />
                                )
                                : (
                                  <div class="flex items-center justify-center w-8 h-8 rounded-full bg-zinc-200 dark:bg-zinc-700 text-sm font-medium text-zinc-900 dark:text-zinc-100">
                                    {commit.author.name.charAt(0).toUpperCase()}
                                  </div>
                                )}
                            </div>
                            <div class="flex-1 min-w-0">
                              <div class="flex items-center gap-2">
                                <span class="text-zinc-900 dark:text-zinc-100 font-medium truncate">
                                  {commit.message.split("\n")[0]}
                                </span>
                                <Show when={commit.message.includes("\n")}>
                                  <button
                                    type="button"
                                    class="px-1.5 py-0.5 text-xs text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                                    aria-label={t("showFullCommitMessage")}
                                  >
                                    ...
                                  </button>
                                </Show>
                              </div>
                              <div class="flex items-center gap-2 mt-1 text-sm text-zinc-500">
                                <span class="text-zinc-500 dark:text-zinc-400">
                                  {commit.author.name}
                                </span>
                                <span>
                                  {formatDetailedRelativeDate(commit.date)}
                                </span>
                              </div>
                            </div>
                            <div class="flex items-center gap-2 flex-shrink-0">
                              <button
                                type="button"
                                class="flex items-center gap-1.5 px-2 py-1 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded text-xs font-mono text-zinc-500 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700 hover:text-zinc-900 dark:hover:text-zinc-100 transition-colors"
                                onClick={() => copyCommitSha(commit.sha)}
                                aria-label={`Copy commit SHA ${
                                  commit.sha.slice(0, 7)
                                }`}
                                title={t("copyCommitSha")}
                              >
                                <Icons.Copy class="w-3 h-3" />
                                <span>{commit.sha.slice(0, 7)}</span>
                              </button>
                              <Show when={commit.stats}>
                                <div class="flex items-center gap-1.5 text-xs">
                                  <span class="text-zinc-900 dark:text-zinc-100">
                                    +{commit.stats!.additions}
                                  </span>
                                  <span class="text-zinc-500">
                                    -{commit.stats!.deletions}
                                  </span>
                                </div>
                              </Show>
                            </div>
                          </div>
                        )}
                      </For>
                    </div>
                  </div>
                )}
              </For>

              <Show when={hasMore()}>
                <div class="flex justify-center py-4">
                  <button
                    type="button"
                    class="flex items-center gap-2 px-6 py-2.5 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg text-zinc-900 dark:text-zinc-100 hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    onClick={loadMore}
                    disabled={loading()}
                  >
                    <Show
                      when={loading()}
                      fallback={<span>{t("loadMoreCommits")}</span>}
                    >
                      <div class="w-4 h-4 border-2 border-zinc-200 dark:border-zinc-700 border-t-zinc-900 dark:border-t-zinc-100 rounded-full animate-spin" />
                      <span>{t("loading")}</span>
                    </Show>
                  </button>
                </div>
              </Show>
            </div>
          </Show>
        </div>
      </Show>
    </>
  );
}
