import type { Accessor, Setter } from "solid-js";
import type { TranslationKey } from "../store/i18n.ts";
import { rpc, rpcJson, rpcPath } from "../lib/rpc.ts";
import type { Message, Run } from "../types/index.ts";
import type { ChatAttachmentMetadata } from "../views/chat/messageMetadata.ts";
import { buildChatMessageMetadata } from "../views/chat/messageMetadata.ts";
import { buildChatAttachmentPath } from "./useChatAttachments.ts";

export interface UseChatMessagesOptions {
  threadId: Accessor<string>;
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
  resetTimeline: () => void;
  setIsLoading: Setter<boolean>;
  setCurrentRun: Setter<Run | null>;
  startWebSocket: (runId: string) => void;
  syncThreadAfterSendFailure: () => Promise<void>;
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

export function useChatMessages({
  threadId,
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
  resetTimeline,
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
  const sendMessage = async () => {
    const currentThreadId = threadId();
    const currentInput = input();
    const currentAttachedFiles = attachedFiles();
    const currentSelectedModel = selectedModel();
    const isCurrentThread = () => threadId() === currentThreadId;
    const trimmedInput = currentInput.trim();
    if ((!trimmedInput && currentAttachedFiles.length === 0) || isLoading()) {
      return;
    }

    const isFirstMessageInThread = messagesCountRef.current === 0;
    const draftInput = currentInput;
    const draftFiles = currentAttachedFiles;
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
    resetTimeline();
    setInput("");
    setAttachedFiles([]);
    setIsLoading(true);

    const tempUserMessage: Message = {
      id: `temp-${Date.now()}`,
      thread_id: currentThreadId,
      role: "user",
      content: trimmedInput,
      metadata: buildChatMessageMetadata({
        attachments: optimisticAttachments,
      }),
      created_at: new Date().toISOString(),
      sequence: 0,
    };
    setMessages((prev) => [...prev, tempUserMessage]);

    let userMessagePersisted = false;
    try {
      const uploadedAttachments = await uploadChatAttachments(draftFiles);
      const msgRes = await rpc.threads[":id"].messages.$post({
        param: { id: currentThreadId },
        json: {
          role: "user",
          content: trimmedInput,
          metadata: uploadedAttachments.length > 0
            ? { attachments: uploadedAttachments }
            : undefined,
        },
      });
      if (msgRes.ok) {
        userMessagePersisted = true;
      }
      const msgData = await rpcJson<{ message: Message }>(msgRes);

      if (isCurrentThread()) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempUserMessage.id ? msgData.message : m))
        );
      }

      if (isFirstMessageInThread) {
        try {
          const titleSource = trimmedInput || uploadedAttachments[0]?.name ||
            "";
          const title = titleSource.slice(0, 50) +
            (titleSource.length > 50 ? "..." : "");
          const titleRes = await rpc.threads[":id"].$patch({
            param: { id: currentThreadId },
            json: { title },
          });
          await rpcJson(titleRes);
          if (isCurrentThread()) {
            onUpdateTitle(title);
          }
        } catch {
          // Title update is best-effort; ignore failures
        }
      }

      const runRes = await rpcPath(rpc, "threads", ":threadId", "runs").$post({
        param: { threadId: currentThreadId },
        json: {
          agent_type: "default",
          model: currentSelectedModel,
          input: { locale: lang },
        },
      });
      const runData = await rpcJson<{ run: Run }>(runRes);
      if (!isCurrentThread()) {
        return;
      }

      setCurrentRun(runData.run);
      startWebSocket(runData.run.id);
    } catch (err) {
      if (!isCurrentThread()) {
        return;
      }
      setIsLoading(false);
      setCurrentRun(null);
      resetStreamingState();
      if (!userMessagePersisted) {
        setMessages((prev) => prev.filter((m) => m.id !== tempUserMessage.id));
        setInput(draftInput);
        setAttachedFiles(draftFiles);
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== tempUserMessage.id));
        await syncThreadAfterSendFailure();
      }
      setError(err instanceof Error ? err.message : t("networkError"));
    }
  };

  return {
    sendMessage,
  };
}
