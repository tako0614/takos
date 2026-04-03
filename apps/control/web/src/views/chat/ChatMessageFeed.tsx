import { createMemo } from "solid-js";
import { For, Show } from "solid-js";
import { useI18n } from "../../store/i18n.ts";
import type { Message, SessionDiff } from "../../types/index.ts";
import { Icons } from "../../lib/Icons.tsx";
import type { ChatStreamingState } from "./chat-types.ts";
import { MessageBubble } from "./MessageBubble.tsx";
import { MarkdownRenderer } from "./MarkdownRenderer.tsx";
import { SessionDiffPanel } from "./SessionDiffPanel.tsx";

type LiveToolCall = ChatStreamingState["toolCalls"][number];

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
  return (
    <div class="py-2 px-4">
      <Show when={props.thinking}>
        <p class="text-sm text-zinc-500 dark:text-zinc-400 italic mb-2 animate-pulse">
          {props.thinking}
        </p>
      </Show>
      <div class="space-y-0.5">
        <For each={props.toolCalls}>
          {(tc) => {
            const isRunning = tc.status === "running" ||
              tc.status === "pending";
            const isError = tc.status === "error";
            return (
              <div class="flex items-center gap-2 text-sm">
                <span
                  class={`text-xs ${
                    isError
                      ? "text-red-500"
                      : isRunning
                      ? "text-zinc-400 dark:text-zinc-500"
                      : "text-green-500"
                  }`}
                >
                  {isError ? "\u2715" : isRunning ? "\u25CF" : "\u2713"}
                </span>
                <span
                  class={isRunning
                    ? "text-zinc-600 dark:text-zinc-400 animate-pulse"
                    : isError
                    ? "text-red-500 dark:text-red-400"
                    : "text-zinc-400 dark:text-zinc-500"}
                >
                  {isRunning ? getToolLabel(tc.name) : tc.name}
                </span>
              </div>
            );
          }}
        </For>
      </div>
    </div>
  );
}

interface ChatMessageFeedProps {
  messages: Message[];
  streaming: ChatStreamingState;
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
  const { t } = useI18n();

  const uniqueMessages = createMemo(() => {
    const messageMap = new Map<string, Message>();
    for (const message of props.messages) {
      messageMap.set(message.id, message);
    }
    return Array.from(messageMap.values());
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

        <For each={uniqueMessages()}>
          {(message) => (
            <MessageBubble
              message={message}
              showToolExecutions
              spaceId={props.spaceId}
            />
          )}
        </For>

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
          <div class="py-2 px-4">
            <p
              class={`text-sm text-zinc-500 dark:text-zinc-400 italic${
                props.isLoading ? " animate-pulse" : ""
              }`}
            >
              {props.streaming.thinking}
            </p>
          </div>
        </Show>

        <Show
          when={props.isLoading && !hasToolCalls() && !props.streaming.thinking}
        >
          <div class="py-2 px-4">
            <p class="text-sm text-zinc-500 dark:text-zinc-400 italic animate-pulse">
              {t("thinking")}
            </p>
          </div>
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
