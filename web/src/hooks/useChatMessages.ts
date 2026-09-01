import type { Accessor, Setter } from "solid-js";
import type { TranslationKey } from "../store/i18n.ts";
import { rpc, rpcJson, rpcPath } from "../lib/rpc.ts";
import { truncateByCodepoint } from "../lib/format.ts";
import type { Message, ThreadHistoryRunSummary } from "../types/index.ts";
import type { ChatAttachmentMetadata } from "../views/chat/messageMetadata.ts";
import { buildChatMessageMetadata } from "../views/chat/messageMetadata.ts";
import { buildChatAttachmentPath } from "./useChatAttachments.ts";
import {
  chatRunIdForOperation,
  createChatOperationId,
  isActiveChatRun,
  isSameChatDraft,
  shouldRetryChatRun,
} from "./chat-operation-id.ts";
import { MAX_CHAT_MESSAGE_CHARACTERS } from "./chat-limits.ts";
import { parseChatMessageMutationResponse } from "./chat-message-response.ts";
import { parseChatThreadResponse } from "./chat-thread-response.ts";
import {
  type ChatRunCreationSummary,
  parseChatRunCreateResponse,
} from "./chat-run-response.ts";
import {
  browserSessionStorage,
  type McpConfirmationRunGrant,
  peekMcpConfirmationRunGrant,
  removeMcpConfirmationRunGrant,
} from "./mcp-confirmation-run-grants.ts";

export interface UseChatMessagesOptions {
  threadId: Accessor<string>;
  spaceRecordId: Accessor<string>;
  lang: string;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  input: Accessor<string>;
  setInput: (value: string) => void;
  selectedModel: Accessor<string>;
  onUpdateTitle: (title: string) => void;
  // From useFileAttachment
  attachedFiles: Accessor<File[]>;
  setAttachedFiles: (files: File[]) => void;
  // From useWebSocketConnection
  isLoading: Accessor<boolean>;
  rootRunIdRef: { current: string | null };
  closeWebSocket: () => void;
  currentRunIdRef: { current: string | null };
  lastEventIdRef: { current: number };
  resetStreamingState: () => void;
  setIsLoading: Setter<boolean>;
  setCurrentRun: Setter<ThreadHistoryRunSummary | null>;
  startWebSocket: (runId: string) => void;
  syncThreadAfterSendFailure: () => Promise<ThreadHistoryRunSummary | null>;
  // From useMessagePolling
  messagesCountRef: { current: number };
  abortPendingFetch: () => void;
  setMessages: Setter<Message[]>;
  setError: (value: string | null) => void;
  // From useChatAttachments
  uploadChatAttachments: (
    selectedFiles: File[],
  ) => Promise<ChatAttachmentMetadata[]>;
}

export interface UseChatMessagesResult {
  sendMessage: () => Promise<void>;
}

interface ChatSendOperation {
  id: string;
  runIdempotencyKey: string;
  threadId: string;
  input: string;
  files: File[];
  uploadedAttachments?: ChatAttachmentMetadata[];
  message?: Message;
  confirmationGrant?: McpConfirmationRunGrant;
}

export function useChatMessages({
  threadId,
  spaceRecordId,
  lang,
  t,
  input,
  setInput,
  selectedModel,
  onUpdateTitle,
  attachedFiles,
  setAttachedFiles,
  isLoading,
  rootRunIdRef,
  closeWebSocket,
  currentRunIdRef,
  lastEventIdRef,
  resetStreamingState,
  setIsLoading,
  setCurrentRun,
  startWebSocket,
  syncThreadAfterSendFailure,
  messagesCountRef,
  abortPendingFetch,
  setMessages,
  setError,
  uploadChatAttachments,
}: UseChatMessagesOptions): UseChatMessagesResult {
  let retryOperation: ChatSendOperation | null = null;

  const sendMessage = async () => {
    const currentThreadId = threadId();
    const currentSpaceRecordId = spaceRecordId();
    const currentInput = input();
    const currentAttachedFiles = attachedFiles();
    const currentSelectedModel = selectedModel();
    const isCurrentThread = () => threadId() === currentThreadId;
    const trimmedInput = currentInput.trim();
    if ((!trimmedInput && currentAttachedFiles.length === 0) || isLoading()) {
      return;
    }
    if (currentInput.length > MAX_CHAT_MESSAGE_CHARACTERS) {
      setError(t("chatMessageTooLong", { count: MAX_CHAT_MESSAGE_CHARACTERS }));
      return;
    }
    if (!currentSelectedModel) {
      setError(t("modelCatalogUnavailable"));
      return;
    }
    setError(null);

    const isFirstMessageInThread = messagesCountRef.current === 0;
    const draftInput = currentInput;
    const draftFiles = currentAttachedFiles;
    const reusableOperation = retryOperation?.threadId === currentThreadId &&
        isSameChatDraft(
          { input: retryOperation.input, files: retryOperation.files },
          { input: draftInput, files: draftFiles },
        )
      ? retryOperation
      : null;
    const operation = reusableOperation ?? {
      id: createChatOperationId(),
      runIdempotencyKey: "",
      threadId: currentThreadId,
      input: draftInput,
      files: draftFiles,
      confirmationGrant: peekMcpConfirmationRunGrant(
        browserSessionStorage(),
        currentSpaceRecordId,
        currentThreadId,
      ) ?? undefined,
    };
    if (!operation.runIdempotencyKey) {
      operation.runIdempotencyKey = operation.id;
    }
    retryOperation = operation;
    const optimisticAttachments: ChatAttachmentMetadata[] = draftFiles.map((
      file,
    ) => ({
      name: file.name,
      path: buildChatAttachmentPath(currentThreadId, file.name),
      mime_type: file.type || null,
      size: file.size,
    }));
    rootRunIdRef.current = null;
    closeWebSocket();
    abortPendingFetch();
    currentRunIdRef.current = null;
    lastEventIdRef.current = 0;
    resetStreamingState();
    setInput("");
    setAttachedFiles([]);
    setIsLoading(true);

    const tempUserMessage: Message | null = operation.message ? null : {
      id: `temp-${operation.id}`,
      thread_id: currentThreadId,
      role: "user",
      content: trimmedInput,
      metadata: buildChatMessageMetadata({
        attachments: optimisticAttachments,
      }),
      created_at: new Date().toISOString(),
      sequence: 0,
    };
    if (tempUserMessage) {
      setMessages((prev) => [...prev, tempUserMessage]);
    }

    let userMessagePersisted = false;
    try {
      const uploadedAttachments = operation.uploadedAttachments ??
        await uploadChatAttachments(draftFiles);
      operation.uploadedAttachments = uploadedAttachments;
      const msgRes = await rpc.threads[":id"].messages.$post({
        param: { id: currentThreadId },
        json: {
          role: "user",
          content: trimmedInput,
          metadata: uploadedAttachments.length > 0
            ? { attachments: uploadedAttachments }
            : undefined,
          idempotency_key: operation.id,
        },
      });
      if (msgRes.ok) {
        userMessagePersisted = true;
      }
      const persistedMessage = parseChatMessageMutationResponse(
        await rpcJson<unknown>(msgRes),
        currentThreadId,
      );
      operation.message = persistedMessage;

      if (isCurrentThread()) {
        setMessages((prev) => {
          if (tempUserMessage) {
            return prev.map((message) =>
              message.id === tempUserMessage.id ? persistedMessage : message
            );
          }
          return prev.some((message) => message.id === persistedMessage.id)
            ? prev
            : [...prev, persistedMessage];
        });
      }

      if (isFirstMessageInThread) {
        try {
          const titleSource = trimmedInput || uploadedAttachments[0]?.name ||
            "";
          const title = truncateByCodepoint(titleSource, 50);
          const titleRes = await rpc.threads[":id"].$patch({
            param: { id: currentThreadId },
            json: { title },
          });
          const updatedThread = parseChatThreadResponse(
            await rpcJson<unknown>(titleRes),
            { spaceId: currentSpaceRecordId, threadId: currentThreadId },
          );
          if (updatedThread.title !== title) {
            throw new TypeError("Mismatched Chat Thread title response");
          }
          if (isCurrentThread()) {
            onUpdateTitle(title);
          }
        } catch {
          // Title update is best-effort; ignore failures
        }
      }

      const requestRun = async (
        idempotencyKey: string,
      ): Promise<ChatRunCreationSummary> => {
        const runRes = await rpcPath(rpc, "threads", ":threadId", "runs")
          .$post({
            param: { threadId: currentThreadId },
            json: {
              agent_type: "default",
              model: currentSelectedModel,
              input: { locale: lang },
              idempotency_key: idempotencyKey,
              confirmation_grant_id: operation.confirmationGrant
                ?.confirmationGrantId,
            },
          });
        return parseChatRunCreateResponse(
          await rpcJson<unknown>(runRes),
          {
            runId: chatRunIdForOperation(idempotencyKey),
            threadId: currentThreadId,
            spaceId: currentSpaceRecordId,
            agentType: "default",
          },
        ).run;
      };

      let run = await requestRun(operation.runIdempotencyKey);
      if (shouldRetryChatRun(run.status)) {
        // The prior request definitely reached a terminal failure. Preserve
        // the canonical user message, but create a fresh idempotent Run
        // attempt. Active/completed replays are never duplicated.
        operation.runIdempotencyKey = createChatOperationId();
        run = await requestRun(operation.runIdempotencyKey);
      }
      if (operation.confirmationGrant) {
        removeMcpConfirmationRunGrant(
          browserSessionStorage(),
          operation.confirmationGrant,
        );
        operation.confirmationGrant = undefined;
      }
      if (!isCurrentThread()) {
        return;
      }

      if (shouldRetryChatRun(run.status)) {
        throw new Error(run.error || t("networkError"));
      }

      setCurrentRun(run);
      if (isActiveChatRun(run.status)) {
        startWebSocket(run.id);
      } else {
        setIsLoading(false);
        await syncThreadAfterSendFailure();
      }
      retryOperation = null;
    } catch (err) {
      if (!isCurrentThread()) {
        return;
      }
      setIsLoading(false);
      setCurrentRun(null);
      resetStreamingState();
      if (!userMessagePersisted) {
        // Upload or message-persist failed: drop the optimistic bubble and
        // restore the composer so the user can resend immediately.
        // Restoring input + files is the implicit "retry button" — the user
        // sees their text back in the composer with the existing send button.
        if (tempUserMessage) {
          setMessages((prev) =>
            prev.filter((message) => message.id !== tempUserMessage.id)
          );
        }
        setInput(draftInput);
        setAttachedFiles(draftFiles);
      } else {
        // Message was persisted server-side but `runs.$post` failed (or a
        // later step threw). Keep the optimistic user message visible in the
        // UI (replacing the temp id with the persisted one if we know it)
        // and restore the composer so the user can retry the run.
        //
        // We intentionally do not remove the bubble: removing it makes the
        // user think their message was lost, when in fact it is persisted
        // and only the agent run failed to start.
        // Refresh server state so the temp bubble is replaced by the real
        // persisted message (if `syncThreadAfterSendFailure` reconciles).
        const recoveredRun = await syncThreadAfterSendFailure();
        if (
          recoveredRun?.id ===
            chatRunIdForOperation(operation.runIdempotencyKey)
        ) {
          retryOperation = null;
          setError(null);
          return;
        }
        setInput(draftInput);
        setAttachedFiles(draftFiles);
      }
      setError(err instanceof Error ? err.message : t("networkError"));
    }
  };

  return {
    sendMessage,
  };
}
