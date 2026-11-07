import { type Accessor, createEffect, createSignal, onCleanup, type Setter } from "solid-js";
import type { TranslationKey } from "../store/i18n.ts";
import { rpc, rpcJson, rpcPath } from "../lib/rpc.ts";
import { truncateByCodepoint } from "../lib/format.ts";
import type { Message, Run } from "../types/index.ts";
import type { ChatAttachmentMetadata } from "../views/chat/messageMetadata.ts";
import { buildChatMessageMetadata, parseChatMessageMetadata } from "../views/chat/messageMetadata.ts";
import { buildChatAttachmentPath } from "./useChatAttachments.ts";
import { createLatestRequest } from "../lib/createLatestRequest.ts";
import { type ChatSendRecovery, useChatSendRecoveryStore } from "./chat-send-recovery.tsx";
export type { ChatSendRecovery } from "./chat-send-recovery.tsx";

export interface ChatSendSyncResult {
  activeRun: Run | null;
}

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
  setIsLoading: Setter<boolean>;
  setCurrentRun: Setter<Run | null>;
  startWebSocket: (runId: string) => void;
  syncThreadAfterSendFailure: (isCurrent?: () => boolean) => Promise<ChatSendSyncResult | undefined>;
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
  sendRecovery: Accessor<ChatSendRecovery | null>;
  recoveryBusy: Accessor<boolean>;
  retryReply: (expected: ChatSendRecovery, confirmedNew?: boolean) => Promise<void>;
  checkSendStatus: (expected: ChatSendRecovery) => Promise<void>;
  restoreSendDraft: (expected: ChatSendRecovery) => void;
  dismissSendRecovery: (expected: ChatSendRecovery, confirmed?: boolean) => void;
  sendBlocked: Accessor<boolean>;
  acknowledgeRunHistory: (runIds: string[]) => void;
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
  const store = useChatSendRecoveryStore();
  const sendRecovery = () => store.get(threadId());
  const sendBlocked = () => !store.verified() || sendRecovery() !== null;
  const [recoveryBusy, setRecoveryBusy] = createSignal(false);
  const requests = createLatestRequest();
  createEffect(() => {
    threadId();
    store.epoch();
    requests.next();
    setRecoveryBusy(false);
  });
  onCleanup(() => { requests.next(); });

  const knownRejection = (status?: number) =>
    status !== undefined && [400, 401, 403, 404, 429].includes(status);

  const startReply = async (receipt: ChatSendRecovery, isCurrent: () => boolean) => {
    let owned = receipt;
    const save = (next: ChatSendRecovery) => {
      if (!store.replace(receipt.threadId, owned, next)) return false;
      owned = next; return true;
    };
    if (!store.verified()) { save({ ...receipt, kind: "reply-rejected", pending: false }); return; }
    let status: number | undefined;
    let accepted: Run | undefined;
    try {
      const response = await rpcPath(rpc, "threads", ":threadId", "runs").$post({
        param: { threadId: receipt.threadId },
        json: { agent_type: "default", model: receipt.model, input: { locale: lang } },
      });
      status = response.status;
      const data = await rpcJson<{ run: Run }>(response, { isCurrent });
      if (status !== 201 || !data.run || typeof data.run.id !== "string" || !data.run.id || data.run.thread_id !== receipt.threadId ||
        !["pending", "queued", "running", "completed", "failed", "cancelled"].includes(data.run.status)) {
        throw new Error(t("replyStatusUnknown"));
      }
      accepted = data.run;
      if (!save({ ...receipt, kind: "reply-known", run: accepted, pending: false })) return;
      if (!isCurrent()) return;
      setCurrentRun(accepted);
      startWebSocket(accepted.id);
      store.replace(receipt.threadId, owned, null);
    } catch (error) {
      const recovery: ChatSendRecovery = {
        ...receipt,
        kind: accepted ? "reply-known" : knownRejection(status) ? "reply-rejected" : "reply-unknown",
        run: accepted,
        checked: false,
        pending: false,
      };
      if (!save(recovery) || !isCurrent()) return;
      setIsLoading(false);
      setCurrentRun(null);
      resetStreamingState();
      setError(error instanceof Error ? error.message : t("networkError"));
      const stillOwned = () => isCurrent() && store.get(receipt.threadId) === owned;
      const synced = await syncThreadAfterSendFailure(stillOwned);
      if (!stillOwned()) return;
      if (accepted && synced?.activeRun?.id === accepted.id) store.replace(receipt.threadId, owned, null);
      else if (synced) save({ ...recovery, checked: true });
    }
  };

  const sendMessage = async () => {
    const currentThreadId = threadId();
    const currentInput = input();
    const currentAttachedFiles = [...attachedFiles()];
    const currentSelectedModel = selectedModel();
    const trimmedInput = currentInput.trim();
    if ((!trimmedInput && currentAttachedFiles.length === 0) || isLoading() || sendBlocked()) {
      return;
    }
    let owned: ChatSendRecovery = { kind: "message-unknown", threadId: currentThreadId,
      text: currentInput, files: currentAttachedFiles, model: currentSelectedModel, pending: true };
    if (!store.replace(currentThreadId, null, owned)) { setError(t("sendRecoveryCapacityReached")); return; }
    const save = (next: ChatSendRecovery) => {
      if (!store.replace(currentThreadId, owned, next)) return false;
      owned = next; return true;
    };
    const claim = requests.claim(() => threadId() === currentThreadId);
    const isCurrentThread = () => claim.won();
    setRecoveryBusy(false);
    setError(null);

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

    let messageDispatched = false;
    let messageStatus: number | undefined;
    let persistedMessage: Message;
    try {
      const uploadedAttachments = await uploadChatAttachments(draftFiles);
      if (!store.owns(currentThreadId, owned)) return;
      if (!store.verified()) { save({ ...owned, kind: "unsent", pending: false }); return; }
      messageDispatched = true;
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
      messageStatus = msgRes.status;
      const msgData = await rpcJson<{ message: Message }>(msgRes, { isCurrent: isCurrentThread });
      if (messageStatus !== 201 || !msgData.message || typeof msgData.message.id !== "string" || !msgData.message.id ||
        msgData.message.thread_id !== currentThreadId || msgData.message.role !== "user" || msgData.message.content !== trimmedInput) {
        throw new Error(t("messageSaveUnknown"));
      }
      const acknowledged = parseChatMessageMetadata(msgData.message.metadata).attachments;
      const fields = ["file_id", "path", "name", "mime_type", "size"] as const;
      if (acknowledged.length !== uploadedAttachments.length || !uploadedAttachments.every((expected, index) =>
        fields.every((field) => (acknowledged[index][field] ?? null) === (expected[field] ?? null)))) {
        throw new Error(t("messageSaveUnknown"));
      }
      if (!store.owns(currentThreadId, owned)) return;
      persistedMessage = msgData.message;
      if (!store.verified()) {
        save({ ...owned, kind: "reply-rejected", messageId: persistedMessage.id, files: [], pending: false });
        return;
      }

      if (isCurrentThread()) {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempUserMessage.id ? msgData.message : m))
        );
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
          await rpcJson(titleRes, { isCurrent: isCurrentThread });
          if (isCurrentThread()) {
            onUpdateTitle(title);
          }
        } catch {
          // Title update is best-effort; ignore failures
        }
      }

    } catch (err) {
      const unsent = !messageDispatched || (messageStatus !== undefined && [400, 401, 403, 404].includes(messageStatus));
      const recovery: ChatSendRecovery = {
        kind: unsent ? "unsent" : "message-unknown", threadId: currentThreadId,
        text: draftInput, files: draftFiles, model: currentSelectedModel,
        pending: false,
      };
      if (!save(recovery) || !isCurrentThread()) return;
      setIsLoading(false);
      setCurrentRun(null);
      resetStreamingState();
      if (unsent) {
        setMessages((prev) => prev.filter((m) => m.id !== tempUserMessage.id));
        if (!input() && attachedFiles().length === 0) {
          setInput(draftInput);
          setAttachedFiles(draftFiles);
          store.replace(currentThreadId, owned, null);
        }
      }
      setError(err instanceof Error ? err.message : t("networkError"));
      return;
    }
    const receipt: ChatSendRecovery = { ...owned, kind: "reply-unknown", messageId: persistedMessage.id, files: [], pending: true };
    if (save(receipt)) await startReply(receipt, isCurrentThread);
  };

  const checkSendStatus = async (expected: ChatSendRecovery) => {
    if (sendRecovery() !== expected || threadId() !== expected.threadId || expected.pending || isLoading() || recoveryBusy()) return;
    const claim = requests.claim(() => threadId() === expected.threadId);
    setRecoveryBusy(true);
    try {
      const result = await syncThreadAfterSendFailure(() => claim.won());
      if (!claim.won()) return;
      if (expected.kind === "reply-known" && expected.run?.id === result?.activeRun?.id) store.replace(expected.threadId, expected, null);
      else if (result) store.replace(expected.threadId, expected, { ...expected, checked: true });
      else setError(t("sendStatusCheckFailed"));
    } finally { if (claim.won()) setRecoveryBusy(false); }
  };

  const retryReply = async (expected: ChatSendRecovery, confirmedNew = false) => {
    if (sendRecovery() !== expected || threadId() !== expected.threadId || expected.pending || isLoading() || recoveryBusy()) return;
    if (expected.kind !== "reply-rejected" && expected.kind !== "reply-known" &&
      !(expected.kind === "reply-unknown" && expected.checked && confirmedNew)) return;
    const claim = requests.claim(() => threadId() === expected.threadId);
    setError(null);
    setIsLoading(true);
    if (expected.kind === "reply-known" && expected.run) {
      try { setCurrentRun(expected.run); startWebSocket(expected.run.id); store.replace(expected.threadId, expected, null); }
      catch (error) { setIsLoading(false); setError(error instanceof Error ? error.message : t("networkError")); }
      return;
    }
    const pending = { ...expected, model: selectedModel(), pending: true };
    if (store.replace(expected.threadId, expected, pending)) await startReply(pending, () => claim.won());
  };

  const restoreSendDraft = (expected: ChatSendRecovery) => {
    if (sendRecovery() !== expected || threadId() !== expected.threadId || expected.pending || isLoading() || recoveryBusy() ||
      input() || attachedFiles().length > 0 || !["unsent", "message-unknown"].includes(expected.kind)) return;
    setInput(expected.text); setAttachedFiles(expected.files); store.replace(expected.threadId, expected, null); setError(null);
  };

  const dismissSendRecovery = (expected: ChatSendRecovery, confirmed = false) => {
    if (sendRecovery() !== expected || threadId() !== expected.threadId || expected.pending || isLoading() || recoveryBusy()) return;
    if (["unsent", "message-unknown", "reply-unknown"].includes(expected.kind) && !confirmed) return;
    store.replace(expected.threadId, expected, null); setError(null);
  };

  const acknowledgeRunHistory = (runIds: string[]) => {
    // The orchestrator supplies only a connected Run or terminal history IDs.
    const receipt = sendRecovery();
    if (receipt?.kind === "reply-known" && receipt.run && runIds.includes(receipt.run.id)) {
      store.replace(receipt.threadId, receipt, null);
    }
  };

  return {
    sendMessage,
    sendRecovery, recoveryBusy, retryReply, checkSendStatus, restoreSendDraft, dismissSendRecovery, sendBlocked, acknowledgeRunHistory,
  };
}
