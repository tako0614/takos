import { createMemo, createSignal } from "solid-js";
import { For, Show } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import type { TranslationKey } from "../../store/i18n.ts";
import type { Message, SessionDiff } from "../../types/index.ts";
import { Icons } from "../../lib/Icons.tsx";
import type { ChatStreamingState } from "./chat-types.ts";
import type { ChatRunMetaMap, ChatTimelineEntry } from "./chat-types.ts";
import { MessageBubble } from "./MessageBubble.tsx";
import { MarkdownRenderer } from "./MarkdownRenderer.tsx";
import { SessionDiffPanel } from "./SessionDiffPanel.tsx";
import {
  buildActiveRunActivityGroups,
  buildPersistentRunActivityGroups,
  type PersistentRunActivityGroup,
} from "./run-activity.ts";

type LiveToolCall = ChatStreamingState["toolCalls"][number];
type ActivityDisplayEntry = {
  key: string;
  type: ChatTimelineEntry["type"];
  message: string;
  detail?: string;
  failed?: boolean;
  createdAt?: number;
};

function getToolLabel(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized.includes("search")) return "検索中…";
  if (normalized.includes("fetch") || normalized.includes("browse")) {
    return "ページ取得中…";
  }
  if (normalized.includes("read")) return "ファイル読み込み中…";
  if (normalized.includes("write")) return "ファイル書き込み中…";
  if (normalized.includes("list")) return "ファイル一覧取得中…";
  if (normalized.includes("exec")) return "コマンド実行中…";
  if (normalized.includes("deploy")) return "デプロイ中…";
  if (
    normalized.includes("memory") || normalized.includes("remember") ||
    normalized.includes("recall")
  ) return "メモリ操作中…";
  return `${name}`;
}

function LiveToolCalls(props: {
  toolCalls: LiveToolCall[];
  thinking: string | null;
}) {
  const entries = createMemo<ActivityDisplayEntry[]>(() => {
    const items: ActivityDisplayEntry[] = [];
    if (props.thinking) {
      items.push({
        key: "live-thinking",
        type: "thinking",
        message: props.thinking,
      });
    }
    for (const toolCall of props.toolCalls) {
      const isRunning = toolCall.status === "running" ||
        toolCall.status === "pending";
      items.push({
        key: `tool:${toolCall.id}`,
        type: toolCall.status === "completed" ? "tool_result" : "tool_call",
        message: isRunning ? getToolLabel(toolCall.name) : toolCall.name,
        detail: toolCall.error || toolCall.result,
        failed: toolCall.status === "error",
        createdAt: toolCall.startedAt,
      });
    }
    return items;
  });
  const hasErrors = () => props.toolCalls.some((tc) => tc.status === "error");

  return (
    <ThinkingDisclosure
      entries={entries()}
      live
      hasErrors={hasErrors()}
    />
  );
}

function runStatusLabelKey(
  status: PersistentRunActivityGroup["status"],
): TranslationKey {
  return `runStatus_${status}` as TranslationKey;
}

function toActivityDisplayEntry(
  entry: ChatTimelineEntry,
): ActivityDisplayEntry {
  return {
    key: entry.key,
    type: entry.type,
    message: entry.message,
    detail: entry.detail,
    failed: entry.failed,
    createdAt: entry.createdAt,
  };
}

function getThinkingDurationSeconds(
  entries: ActivityDisplayEntry[],
): number | null {
  const times = entries
    .map((entry) => entry.createdAt)
    .filter((time): time is number =>
      typeof time === "number" && Number.isFinite(time)
    );
  if (times.length < 2) return null;
  const start = Math.min(...times);
  const end = Math.max(...times);
  if (end <= start) return null;
  return Math.max(1, Math.round((end - start) / 1000));
}

function activityDotClass(entry: ActivityDisplayEntry): string {
  if (entry.failed) return "bg-red-500";
  if (entry.type === "tool_result") return "bg-emerald-500";
  if (entry.type === "tool_call") return "bg-blue-500";
  if (entry.type === "thinking") return "bg-zinc-400 dark:bg-zinc-500";
  return "bg-zinc-300 dark:bg-zinc-600";
}

function ThinkingDisclosure(props: {
  entries: ActivityDisplayEntry[];
  status?: PersistentRunActivityGroup["status"];
  live?: boolean;
  hasErrors?: boolean;
}) {
  const { t } = useI18n();
  const [expanded, setExpanded] = createSignal(false);
  const durationSeconds = createMemo(() =>
    getThinkingDurationSeconds(props.entries)
  );
  const label = createMemo(() => {
    if (props.live) return t("thinkingSummaryLive");
    const seconds = durationSeconds();
    if (seconds !== null) {
      return t("thinkingSummaryTimed", { seconds });
    }
    return t("thinkingSummary");
  });
  const statusLabel = createMemo(() =>
    props.status ? t(runStatusLabelKey(props.status)) : ""
  );
  const toneClass = () =>
    props.hasErrors
      ? "text-red-600 hover:text-red-700 dark:text-red-300 dark:hover:text-red-200"
      : "text-zinc-500 hover:text-zinc-700 dark:text-zinc-400 dark:hover:text-zinc-200";
  const borderClass = () =>
    props.hasErrors
      ? "border-red-200 dark:border-red-900/70"
      : "border-zinc-200 dark:border-zinc-700";

  return (
    <div class="py-1.5 px-4">
      <button
        type="button"
        class={`group inline-flex max-w-full items-center gap-1.5 rounded-md py-1 pr-1 text-sm transition-colors ${toneClass()}`}
        aria-expanded={expanded()}
        aria-label={expanded() ? t("hideDetails") : t("showDetails")}
        onClick={() => setExpanded((value) => !value)}
      >
        <span
          class={`inline-flex h-4 w-4 flex-shrink-0 items-center justify-center ${
            props.live ? "animate-pulse" : ""
          }`}
        >
          <Icons.Sparkles class="h-3.5 w-3.5" />
        </span>
        <span class="min-w-0 truncate">{label()}</span>
        <Show when={!props.live && statusLabel()}>
          <span class="flex-shrink-0 text-xs text-zinc-400 dark:text-zinc-500">
            {statusLabel()}
          </span>
        </Show>
        <Icons.ChevronDown
          class={`h-3.5 w-3.5 flex-shrink-0 transition-transform ${
            expanded() ? "rotate-180" : ""
          }`}
        />
      </button>

      <Show when={expanded() && props.entries.length > 0}>
        <div class={`ml-2 mt-1 space-y-2 border-l pl-4 ${borderClass()}`}>
          <For each={props.entries}>
            {(entry) => (
              <div class="flex min-w-0 gap-2 text-sm">
                <span
                  class={`mt-2 h-1.5 w-1.5 flex-shrink-0 rounded-full ${
                    activityDotClass(entry)
                  }`}
                />
                <div class="min-w-0 flex-1">
                  <p
                    class={`whitespace-pre-wrap break-words leading-relaxed ${
                      entry.failed
                        ? "text-red-700 dark:text-red-200"
                        : "text-zinc-600 dark:text-zinc-300"
                    }`}
                  >
                    {entry.message}
                  </p>
                  <Show when={entry.detail}>
                    <p
                      class={`mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed ${
                        entry.failed
                          ? "text-red-600 dark:text-red-300"
                          : "text-zinc-400 dark:text-zinc-500"
                      }`}
                    >
                      {entry.detail}
                    </p>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

function RunActivityLog(props: {
  group: PersistentRunActivityGroup;
  live?: boolean;
}) {
  const hasErrors = () => props.group.entries.some((entry) => entry.failed);
  const entries = createMemo(() =>
    props.group.entries.map(toActivityDisplayEntry)
  );

  return (
    <ThinkingDisclosure
      entries={entries()}
      status={props.group.status}
      live={props.live}
      hasErrors={hasErrors()}
    />
  );
}

interface ChatMessageFeedProps {
  messages: Message[];
  streaming: ChatStreamingState;
  timelineEntries: ChatTimelineEntry[];
  runMetaById: ChatRunMetaMap;
  isLoading: boolean;
  sessionDiff: { sessionId: string; diff: SessionDiff } | null;
  onMerge: () => void;
  isMerging: boolean;
  onDismissDiff: () => void;
  emptyText: string;
  messagesEndRef: (element: HTMLDivElement | undefined) => void;
  spaceId?: string;
}

export function ChatMessageFeed(props: ChatMessageFeedProps) {
  const uniqueMessages = createMemo(() => {
    const messageMap = new Map<string, Message>();
    for (const message of props.messages) {
      messageMap.set(message.id, message);
    }
    return Array.from(messageMap.values());
  });

  const persistentRunActivity = createMemo(() =>
    buildPersistentRunActivityGroups(
      props.timelineEntries,
      props.runMetaById,
    )
  );
  const restoredActiveRunActivity = createMemo(() =>
    buildActiveRunActivityGroups(
      props.timelineEntries,
      props.runMetaById,
    )
  );

  const feedItems = createMemo(() => {
    const items: Array<
      | {
        type: "message";
        key: string;
        createdAt: number;
        message: Message;
      }
      | {
        type: "run-activity";
        key: string;
        createdAt: number;
        group: PersistentRunActivityGroup;
      }
    > = [];

    for (const message of uniqueMessages()) {
      items.push({
        type: "message",
        key: `message:${message.id}`,
        createdAt: Date.parse(message.created_at),
        message,
      });
    }
    for (const group of persistentRunActivity()) {
      items.push({
        type: "run-activity",
        key: `run-activity:${group.runId}`,
        createdAt: group.createdAt,
        group,
      });
    }

    items.sort((a, b) => {
      const aTime = Number.isFinite(a.createdAt) ? a.createdAt : 0;
      const bTime = Number.isFinite(b.createdAt) ? b.createdAt : 0;
      if (aTime !== bTime) return aTime - bTime;
      if (a.type === b.type) return a.key.localeCompare(b.key);
      return a.type === "message" ? -1 : 1;
    });
    return items;
  });

  const lastAssistantMessage = createMemo(() => {
    const msgs = uniqueMessages();
    for (let i = msgs.length - 1; i >= 0; i -= 1) {
      const message = msgs[i];
      if (message.role === "assistant" && message.content) {
        return message;
      }
    }
    return null;
  });

  const showEmpty = () =>
    uniqueMessages().length === 0 &&
    !props.isLoading &&
    !props.streaming.currentMessage &&
    !props.sessionDiff;

  const hasToolCalls = () => props.streaming.toolCalls.length > 0;
  const hasLiveActivity = () => hasToolCalls() || !!props.streaming.thinking;
  const showRestoredActiveActivity = () =>
    props.isLoading && !hasLiveActivity() &&
    restoredActiveRunActivity().length > 0;

  return (
    <div class="flex-1 overflow-y-auto flex flex-col">
      <div class="w-full max-w-3xl mx-auto flex-1 flex flex-col">
        <Show when={showEmpty()}>
          <div class="flex flex-1 flex-col items-center justify-center text-zinc-500 dark:text-zinc-400">
            <span class="w-8 h-8 [&>svg]:w-full [&>svg]:h-full">
              <Icons.MessageSquare />
            </span>
            <p class="mt-2">{props.emptyText}</p>
          </div>
        </Show>

        <For each={feedItems()}>
          {(item) => (
            item.type === "message"
              ? (
                <MessageBubble
                  message={item.message}
                  showToolExecutions
                  spaceId={props.spaceId}
                />
              )
              : <RunActivityLog group={item.group} />
          )}
        </For>

        <Show when={showRestoredActiveActivity()}>
          <For each={restoredActiveRunActivity()}>
            {(group) => <RunActivityLog group={group} live />}
          </For>
        </Show>

        <Show when={hasToolCalls()}>
          <LiveToolCalls
            toolCalls={props.streaming.toolCalls}
            thinking={props.streaming.thinking}
          />
        </Show>

        <Show
          when={!hasToolCalls() && !props.streaming.currentMessage &&
            props.streaming.thinking}
        >
          <ThinkingDisclosure
            live={props.isLoading}
            entries={[{
              key: "live-thinking",
              type: "thinking",
              message: props.streaming.thinking!,
            }]}
          />
        </Show>

        <Show
          when={props.isLoading && !hasLiveActivity() &&
            restoredActiveRunActivity().length === 0}
        >
          <ThinkingDisclosure live entries={[]} />
        </Show>

        <Show
          when={props.streaming.currentMessage &&
            props.streaming.currentMessage !== lastAssistantMessage()?.content}
        >
          <div class="py-3 px-4">
            <div class="prose dark:prose-invert max-w-none text-zinc-900 dark:text-zinc-100">
              <MarkdownRenderer content={props.streaming.currentMessage!} />
            </div>
          </div>
        </Show>

        <Show when={props.sessionDiff}>
          <SessionDiffPanel
            sessionDiff={props.sessionDiff!}
            onMerge={props.onMerge}
            isMerging={props.isMerging}
            onDismiss={props.onDismissDiff}
          />
        </Show>

        <div ref={props.messagesEndRef} />
      </div>
    </div>
  );
}
