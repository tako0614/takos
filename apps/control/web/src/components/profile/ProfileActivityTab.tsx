import { For, Show } from "solid-js";
import { Icons } from "../../lib/Icons.tsx";
import { useI18n } from "../../store/i18n.ts";
import { EmptyState } from "../common/EmptyState.tsx";
import type { ActivityEvent } from "../../types/profile.ts";

function formatDay(value: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatTime(value: string): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return value;
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function iconForEvent(type: ActivityEvent["type"]) {
  switch (type) {
    case "commit":
      return <Icons.GitCommit class="w-4 h-4" />;
    case "pull_request":
      return <Icons.GitPullRequest class="w-4 h-4" />;
    case "release":
      return <Icons.Tag class="w-4 h-4" />;
    case "deployment":
      return <Icons.Zap class="w-4 h-4" />;
    default:
      return <Icons.Info class="w-4 h-4" />;
  }
}

export function ProfileActivityTab(props: {
  events: ActivityEvent[];
  onNavigateToRepo?: (ownerUsername: string, repoName: string) => void;
}) {
  const { t } = useI18n();

  const groupedEvents = () => {
    if (!props.events || props.events.length === 0) return null;
    const groups = new Map<string, ActivityEvent[]>();
    for (const ev of props.events) {
      const key = formatDay(ev.created_at);
      const list = groups.get(key) || [];
      list.push(ev);
      groups.set(key, list);
    }
    return Array.from(groups.entries());
  };

  return (
    <Show
      when={groupedEvents()}
      fallback={
        <EmptyState
          icon={<Icons.Zap class="w-12 h-12 mb-4" />}
          title={t("noActivityYet")}
        />
      }
    >
      {(entries) => (
        <div class="space-y-6">
          <For each={entries()}>
            {([day, dayEvents]) => (
              <div>
                <h3 class="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  {day}
                </h3>
                <div class="mt-3 space-y-3">
                  <For each={dayEvents}>
                    {(ev) => (
                      <div class="flex gap-3 p-4 rounded-lg bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700">
                        <div class="mt-0.5 text-zinc-500 dark:text-zinc-400">
                          {iconForEvent(ev.type)}
                        </div>
                        <div class="min-w-0 flex-1">
                          <div class="font-medium text-zinc-900 dark:text-zinc-100 truncate">
                            {ev.title}
                          </div>
                          <Show
                            when={ev.repo?.owner_username && ev.repo?.name}
                            fallback={
                              <div class="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                                {ev.type === "deployment"
                                  ? "Infrastructure"
                                  : ""}
                              </div>
                            }
                          >
                            <button
                              type="button"
                              onClick={() =>
                                props.onNavigateToRepo?.(
                                  ev.repo!.owner_username,
                                  ev.repo!.name,
                                )}
                              class="mt-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              {ev.repo!.owner_username}/{ev.repo!.name}
                            </button>
                          </Show>
                          <div class="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                            {formatTime(ev.created_at)}
                          </div>
                        </div>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            )}
          </For>
        </div>
      )}
    </Show>
  );
}
