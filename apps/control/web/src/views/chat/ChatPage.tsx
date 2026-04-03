import { createEffect, createMemo, createSignal, onCleanup } from "solid-js";
import { Show } from "solid-js";
import { ChatView } from "../ChatView.tsx";
import { ChatHeader } from "./ChatHeader.tsx";
import { ModelSwitcher } from "./ModelSwitcher.tsx";
import { ChatSearchModal } from "./ChatSearchModal.tsx";
import { useI18n } from "../../store/i18n.ts";
import { useToast } from "../../store/toast.ts";
import { useMobileHeader } from "../../store/mobile-header.ts";
import { rpc, rpcJson } from "../../lib/rpc.ts";
import { DEFAULT_MODEL_ID } from "../../lib/modelCatalog.ts";
import {
  findSpaceByIdentifier,
  getPersonalSpace,
  getSpaceIdentifier,
} from "../../lib/spaces.ts";
import type { Space, Thread } from "../../types/index.ts";
import { WelcomeView } from "../app/space/WelcomeView.tsx";
import {
  type MessageSequenceLookupPage,
  resolveMessageSequenceById,
} from "./message-sequence-resolver.ts";

interface ChatPageProps {
  spaces: Space[];
  initialSpaceId?: string;
  initialThreadId?: string;
  initialRunId?: string;
  initialMessageId?: string;
  onSpaceChange?: (spaceId: string) => void;
  onThreadChange?: (threadId: string | undefined) => void;
  onUpdateThread?: (threadId: string, updates: Partial<Thread>) => void;
  onNewThreadCreated?: (spaceId: string, thread: Thread) => void;
}

export function ChatPage(props: ChatPageProps) {
  const { t, lang } = useI18n();
  const { showToast } = useToast();
  const mobileHeader = useMobileHeader();

  const [selectedSpaceId, setSelectedSpaceId] = createSignal<string | null>(
    props.initialSpaceId || null,
  );

  // Model state for WelcomeView header
  const [selectedModel, setSelectedModel] = createSignal<string>(
    DEFAULT_MODEL_ID,
  );

  const selectedSpace = createMemo(() => {
    const spaceId = selectedSpaceId();
    if (spaceId) {
      return findSpaceByIdentifier(props.spaces, spaceId, t("personal"));
    }
    return null;
  });

  const [selectedThread, setSelectedThread] = createSignal<Thread | null>(null);
  const [pendingMessage, setPendingMessage] = createSignal<string | null>(null);
  const [pendingFiles, setPendingFiles] = createSignal<File[] | null>(null);
  const [showSearchModal, setShowSearchModal] = createSignal(false);
  const [jumpToMessageId, setJumpToMessageId] = createSignal<string | null>(
    props.initialMessageId ?? null,
  );
  const [jumpToMessageSequence, setJumpToMessageSequence] = createSignal<
    number | null
  >(null);
  const [focusRunId, setFocusRunId] = createSignal<string | null>(
    props.initialRunId ?? null,
  );

  createEffect(() => {
    const routeSpaceId = props.initialSpaceId ?? null;
    if (routeSpaceId && selectedSpaceId() !== routeSpaceId) {
      setSelectedSpaceId(routeSpaceId);
      return;
    }
    if (props.spaces.length > 0 && !selectedSpaceId()) {
      const ws = getPersonalSpace(props.spaces, t("personal")) ||
        props.spaces[0];
      const identifier = getSpaceIdentifier(ws);
      setSelectedSpaceId(identifier);
      props.onSpaceChange?.(identifier);
    }
  });

  createEffect(() => {
    const spaceId = selectedSpaceId();
    if (!spaceId) return;
    let cancelled = false;
    const fetchModel = async () => {
      try {
        const res = await rpc.spaces[":spaceId"].model.$get({
          param: { spaceId },
        });
        const data = await rpcJson<{ ai_model?: string; model?: string }>(res);
        if (cancelled) return;
        const model = data.ai_model || data.model || DEFAULT_MODEL_ID;
        setSelectedModel(model);
      } catch {
        // keep default
      }
    };
    fetchModel();
    onCleanup(() => {
      cancelled = true;
    });
  });

  // WelcomeView表示時のみモバイルヘッダーにモデル切り替えを注入（スレッドがあるときはChatViewが担当）
  createEffect(() => {
    if (selectedThread()) return;
    mobileHeader.setHeaderContent(
      <ModelSwitcher
        selectedModel={selectedModel()}
        isLoading={false}
        onModelChange={async (model) => {
          setSelectedModel(model);
          const spaceId = selectedSpaceId();
          if (spaceId) {
            try {
              const res = await rpc.spaces[":spaceId"].model.$patch({
                param: { spaceId },
                json: { model } as Record<string, string>,
              });
              await rpcJson(res);
            } catch {
              // non-fatal
            }
          }
        }}
      />,
    );
    onCleanup(() => mobileHeader.setHeaderContent(null));
  });

  createEffect(() => {
    const currentThreadId = props.initialThreadId;
    let cancelled = false;
    if (currentThreadId) {
      setSelectedThread((prev) => (prev?.id === currentThreadId ? prev : null));
      const fetchThread = async () => {
        try {
          const res = await rpc.threads[":id"].$get({
            param: { id: currentThreadId },
          });
          const data = await rpcJson<{ thread: Thread }>(res);
          if (cancelled) return;
          setSelectedThread(data.thread);
        } catch {
          if (cancelled) return;
          setSelectedThread(null);
        }
      };
      fetchThread();
    } else {
      setSelectedThread(null);
    }
    onCleanup(() => {
      cancelled = true;
    });
  });

  createEffect(() => {
    setFocusRunId(props.initialRunId ?? null);
  });

  createEffect(() => {
    setJumpToMessageId(props.initialMessageId ?? null);
    setJumpToMessageSequence(null);
  });

  createEffect(() => {
    const currentThreadId = props.initialThreadId ?? null;
    const currentMessageId = jumpToMessageId();
    const currentSequence = jumpToMessageSequence();
    if (!currentThreadId || !currentMessageId || currentSequence != null) {
      return;
    }

    let cancelled = false;

    const resolveMessageSequence = async () => {
      const currentSequenceValue = await resolveMessageSequenceById({
        messageId: currentMessageId,
        fetchPage: async (offset, limit) => {
          const res = await rpc.threads[":id"].messages.$get({
            param: { id: currentThreadId },
            query: {
              limit: String(limit),
              offset: String(offset),
            },
          });
          return await rpcJson<MessageSequenceLookupPage>(res);
        },
      });

      if (cancelled) return;
      if (
        props.initialThreadId !== currentThreadId ||
        jumpToMessageId() !== currentMessageId
      ) {
        return;
      }

      if (typeof currentSequenceValue === "number") {
        setJumpToMessageSequence(currentSequenceValue);
        return;
      }

      showToast("error", t("messageNotLoaded"));
      setJumpToMessageId(null);
      setJumpToMessageSequence(null);
    };

    void resolveMessageSequence();

    onCleanup(() => {
      cancelled = true;
    });
  });

  const openSearchResult = async (
    threadId: string,
    messageId: string,
    sequence: number,
  ) => {
    try {
      const res = await rpc.threads[":id"].$get({ param: { id: threadId } });
      const data = await rpcJson<{ thread: Thread }>(res);
      const thread = data.thread;
      setSelectedThread(thread);
      props.onThreadChange?.(thread.id);
      setJumpToMessageId(messageId);
      setJumpToMessageSequence(sequence);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : t("failedToLoad"),
      );
    }
  };

  // Called by WelcomeView when user sends a message
  const handleCreateThread = async (message: string, files?: File[]) => {
    const spaceId = selectedSpaceId();
    if (!spaceId) return;
    try {
      const res = await rpc.spaces[":spaceId"].threads.$post({
        param: { spaceId },
        json: { title: message.slice(0, 60), locale: lang },
      });
      const data = await rpcJson<{ thread: Thread }>(res);
      const thread = data.thread;
      props.onNewThreadCreated?.(spaceId, thread);
      setSelectedThread(thread);
      setPendingMessage(message);
      setPendingFiles(files ?? null);
      props.onThreadChange?.(thread.id);
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : t("failedToCreate"),
      );
    }
  };

  return (
    <div class="flex flex-1 h-full bg-white dark:bg-zinc-900">
      <main class="flex-1 flex flex-col min-w-0 h-full">
        <Show
          when={selectedThread() && selectedSpace()}
          fallback={
            <Show
              when={selectedSpace()}
              fallback={
                <div class="flex-1 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
                  <p>{t("selectSpaceToChat")}</p>
                </div>
              }
            >
              <ChatHeader
                selectedModel={selectedModel()}
                isLoading={false}
                onModelChange={async (model) => {
                  setSelectedModel(model);
                  const spaceId = selectedSpaceId();
                  if (spaceId) {
                    try {
                      const res = await rpc.spaces[":spaceId"].model.$patch({
                        param: { spaceId },
                        json: { model } as Record<string, string>,
                      });
                      await rpcJson(res);
                    } catch {
                      // non-fatal
                    }
                  }
                }}
              />
              <WelcomeView
                space={selectedSpace()!}
                onNewChat={() => {
                  props.onSpaceChange?.(getSpaceIdentifier(selectedSpace()!));
                }}
                onCreateThread={handleCreateThread}
              />
            </Show>
          }
        >
          <ChatView
            thread={selectedThread()!}
            spaceId={getSpaceIdentifier(selectedSpace()!)}
            jumpToMessageId={jumpToMessageId()}
            jumpToMessageSequence={jumpToMessageSequence()}
            focusRunId={focusRunId()}
            onJumpHandled={() => {
              setJumpToMessageId(null);
              setJumpToMessageSequence(null);
            }}
            onRunFocusHandled={() => {
              setFocusRunId(null);
            }}
            onOpenSearch={selectedSpaceId()
              ? () => setShowSearchModal(true)
              : undefined}
            initialMessage={pendingMessage() ?? undefined}
            initialFiles={pendingFiles() ?? undefined}
            onInitialMessageSent={() => {
              setPendingMessage(null);
              setPendingFiles(null);
            }}
            onUpdateTitle={(title) => {
              setSelectedThread((prev) => (prev ? { ...prev, title } : prev));
              const thread = selectedThread();
              if (thread) {
                props.onUpdateThread?.(thread.id, { title });
              }
            }}
          />
        </Show>
      </main>

      <Show when={showSearchModal() && selectedSpaceId()}>
        <ChatSearchModal
          spaceId={selectedSpaceId()!}
          onSelectResult={openSearchResult}
          onClose={() => setShowSearchModal(false)}
        />
      </Show>
    </div>
  );
}
