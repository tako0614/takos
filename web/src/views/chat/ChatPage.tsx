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
import { useChatModelSelection } from "../../hooks/useChatModelSelection.ts";
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
import { parseChatMessagesResponse } from "../../hooks/chat-message-response.ts";
import {
  createChatOperationId,
  isSameChatDraft,
} from "../../hooks/chat-operation-id.ts";
import { parseChatThreadResponse } from "../../hooks/chat-thread-response.ts";

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
  onToggleArchiveThread?: (thread: Thread) => Promise<boolean>;
}

export function ChatPage(props: ChatPageProps) {
  const { t, lang } = useI18n();
  const { showToast } = useToast();
  const mobileHeader = useMobileHeader();

  const [selectedSpaceId, setSelectedSpaceId] = createSignal<string | null>(
    props.initialSpaceId || null,
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
  const [pendingModel, setPendingModel] = createSignal<string | null>(null);
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
  let threadCreationOperation: {
    id: string;
    spaceId: string;
    model: string;
    input: string;
    files: File[];
  } | null = null;

  const activeChatBundle = createMemo(() => {
    const thread = selectedThread();
    const space = selectedSpace();
    return thread && space ? { thread, space } : undefined;
  });
  const modelSelection = useChatModelSelection({
    spaceId: () => selectedSpaceId() ?? "",
  });

  createEffect(() => {
    const routeSpaceId = props.initialSpaceId ?? null;
    if (routeSpaceId && selectedSpaceId() !== routeSpaceId) {
      setSelectedSpaceId(routeSpaceId);
      return;
    }
    if (props.spaces.length > 0 && !selectedSpaceId()) {
      const ws =
        getPersonalSpace(props.spaces, t("personal")) || props.spaces[0];
      const identifier = getSpaceIdentifier(ws);
      setSelectedSpaceId(identifier);
      props.onSpaceChange?.(identifier);
    }
  });

  // WelcomeView表示時のみモバイルヘッダーにモデル切り替えを注入（スレッドがあるときはChatViewが担当）
  createEffect(() => {
    if (selectedThread()) return;
    mobileHeader.setHeaderContent(
      <ModelSwitcher
        selectedModel={modelSelection.selectedModel()}
        models={modelSelection.availableModels()}
        isLoading={modelSelection.isLoading()}
        hasError={modelSelection.hasError()}
        onRetry={() => void modelSelection.fetchSpaceModels()}
        onModelChange={modelSelection.setSelectedModel}
      />,
    );
    onCleanup(() => mobileHeader.setHeaderContent(null));
  });

  createEffect(() => {
    const currentThreadId = props.initialThreadId;
    const currentSpaceRecordId = selectedSpace()?.id;
    let cancelled = false;
    if (currentThreadId && currentSpaceRecordId) {
      setSelectedThread((prev) => (prev?.id === currentThreadId ? prev : null));
      const fetchThread = async () => {
        try {
          const res = await rpc.threads[":id"].$get({
            param: { id: currentThreadId },
          });
          const thread = parseChatThreadResponse(
            await rpcJson<unknown>(res),
            { spaceId: currentSpaceRecordId, threadId: currentThreadId },
          );
          if (cancelled) return;
          setSelectedThread(thread);
        } catch {
          if (cancelled) return;
          setSelectedThread(null);
          showToast("error", t("failedToLoad"));
          props.onThreadChange?.(undefined);
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
          const page = parseChatMessagesResponse(
            await rpcJson<unknown>(res),
            currentThreadId,
            { limit, offset },
          );
          return page satisfies MessageSequenceLookupPage;
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
      const currentSpaceRecordId = selectedSpace()?.id;
      if (!currentSpaceRecordId) return false;
      const res = await rpc.threads[":id"].$get({ param: { id: threadId } });
      const thread = parseChatThreadResponse(
        await rpcJson<unknown>(res),
        { spaceId: currentSpaceRecordId, threadId },
      );
      setSelectedThread(thread);
      props.onThreadChange?.(thread.id);
      setJumpToMessageId(messageId);
      setJumpToMessageSequence(sequence);
      return true;
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : t("failedToLoad"),
      );
      return false;
    }
  };

  // Called by WelcomeView when user sends a message
  const handleCreateThread = async (message: string, files?: File[]) => {
    const spaceId = selectedSpaceId();
    const currentSpaceRecordId = selectedSpace()?.id;
    if (!spaceId || !currentSpaceRecordId || !modelSelection.isReady()) {
      return false;
    }
    const model = modelSelection.selectedModel();
    const draft = { input: message, files: files ?? [] };
    if (
      !threadCreationOperation ||
      threadCreationOperation.spaceId !== spaceId ||
      threadCreationOperation.model !== model ||
      !isSameChatDraft(threadCreationOperation, draft)
    ) {
      threadCreationOperation = {
        id: createChatOperationId(),
        spaceId,
        model,
        ...draft,
      };
    }
    const operationId = threadCreationOperation.id;
    try {
      const res = await rpc.spaces[":spaceId"].threads.$post({
        param: { spaceId },
        json: {
          title: message.slice(0, 60),
          locale: lang,
          idempotency_key: operationId,
        },
      });
      const thread = parseChatThreadResponse(
        await rpcJson<unknown>(res),
        { spaceId: currentSpaceRecordId },
      );
      props.onNewThreadCreated?.(spaceId, thread);
      setPendingMessage(message);
      setPendingFiles(files ?? null);
      setPendingModel(modelSelection.selectedModel());
      setSelectedThread(thread);
      props.onThreadChange?.(thread.id);
      threadCreationOperation = null;
      return true;
    } catch (err) {
      showToast(
        "error",
        err instanceof Error ? err.message : t("failedToCreate"),
      );
      return false;
    }
  };

  const unarchiveSelectedThread = async (): Promise<boolean> => {
    const thread = selectedThread();
    if (
      !thread || thread.status !== "archived" ||
      !props.onToggleArchiveThread
    ) {
      return false;
    }
    const accepted = await props.onToggleArchiveThread(thread);
    if (!accepted) return false;
    const activeThread: Thread = { ...thread, status: "active" };
    setSelectedThread(activeThread);
    props.onUpdateThread?.(thread.id, { status: "active" });
    return true;
  };

  return (
    <div class="flex flex-1 h-full bg-white dark:bg-zinc-900">
      <main class="flex-1 flex flex-col min-w-0 h-full">
        <Show
          when={activeChatBundle()}
          fallback={
            <Show
              when={selectedSpace()}
              fallback={
                <div class="flex-1 flex items-center justify-center text-zinc-500 dark:text-zinc-400">
                  <p>{t("selectSpaceToChat")}</p>
                </div>
              }
            >
              {(space) => (
                <>
                  <ChatHeader
                    selectedModel={modelSelection.selectedModel()}
                    models={modelSelection.availableModels()}
                    isLoading={modelSelection.isLoading()}
                    hasError={modelSelection.hasError()}
                    onRetry={() => void modelSelection.fetchSpaceModels()}
                    onModelChange={modelSelection.setSelectedModel}
                  />
                  <WelcomeView
                    space={space()}
                    canSend={modelSelection.isReady()}
                    onNewChat={() => {
                      props.onSpaceChange?.(getSpaceIdentifier(space()));
                    }}
                    onCreateThread={handleCreateThread}
                  />
                </>
              )}
            </Show>
          }
        >
          {(bundle) => (
            <ChatView
              thread={bundle().thread}
              spaceId={getSpaceIdentifier(bundle().space)}
              spaceRecordId={bundle().space.id}
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
              onOpenSearch={
                selectedSpaceId() ? () => setShowSearchModal(true) : undefined
              }
              onUnarchive={
                bundle().thread.status === "archived"
                  ? unarchiveSelectedThread
                  : undefined
              }
              initialMessage={pendingMessage() ?? undefined}
              initialFiles={pendingFiles() ?? undefined}
              initialModel={pendingModel() ?? undefined}
              onInitialMessageSent={() => {
                setPendingMessage(null);
                setPendingFiles(null);
                setPendingModel(null);
              }}
              onUpdateTitle={(title) => {
                setSelectedThread((prev) => (prev ? { ...prev, title } : prev));
                const thread = selectedThread();
                if (thread) {
                  props.onUpdateThread?.(thread.id, { title });
                }
              }}
            />
          )}
        </Show>
      </main>

      <Show when={showSearchModal() ? selectedSpaceId() : undefined}>
        {(spaceId) => (
          <ChatSearchModal
            spaceId={spaceId()}
            onSelectResult={openSearchResult}
            onClose={() => setShowSearchModal(false)}
          />
        )}
      </Show>
    </div>
  );
}
