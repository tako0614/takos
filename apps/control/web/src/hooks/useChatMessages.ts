import { useCallback } from 'react';
import type { TranslationKey } from '../store/i18n';
import { rpc, rpcJson } from '../lib/rpc';
import type { Message, Run } from '../types';
import type { ChatAttachmentMetadata } from '../views/chat/messageMetadata';
import { buildChatMessageMetadata } from '../views/chat/messageMetadata';
import { buildChatAttachmentPath } from './useChatAttachments';

export interface UseChatMessagesOptions {
  threadId: string;
  lang: string;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  input: string;
  setInput: (value: string) => void;
  selectedModel: string;
  onUpdateTitle: (title: string) => void;
  // From useFileAttachment
  attachedFiles: File[];
  setAttachedFiles: (files: File[]) => void;
  // From useWebSocketConnection
  isLoading: boolean;
  rootRunIdRef: React.MutableRefObject<string | null>;
  closeWebSocket: () => void;
  currentRunIdRef: React.MutableRefObject<string | null>;
  lastEventIdRef: React.MutableRefObject<number>;
  resetStreamingState: () => void;
  resetTimeline: () => void;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setCurrentRun: React.Dispatch<React.SetStateAction<Run | null>>;
  startWebSocket: (runId: string) => void;
  syncThreadAfterSendFailure: () => Promise<void>;
  // From useMessagePolling
  messagesCountRef: React.MutableRefObject<number>;
  abortPendingFetch: () => void;
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  setError: (value: string | null) => void;
  // From useChatAttachments
  uploadChatAttachments: (selectedFiles: File[]) => Promise<ChatAttachmentMetadata[]>;
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
  const sendMessage = useCallback(async () => {
    const trimmedInput = input.trim();
    if ((!trimmedInput && attachedFiles.length === 0) || isLoading) return;

    const isFirstMessageInThread = messagesCountRef.current === 0;
    const draftInput = input;
    const draftFiles = attachedFiles;
    const optimisticAttachments: ChatAttachmentMetadata[] = draftFiles.map((file) => ({
      name: file.name,
      path: buildChatAttachmentPath(threadId, file.name),
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
    setInput('');
    setAttachedFiles([]);
    setIsLoading(true);

    const tempUserMessage: Message = {
      id: `temp-${Date.now()}`,
      thread_id: threadId,
      role: 'user',
      content: trimmedInput,
      metadata: buildChatMessageMetadata({ attachments: optimisticAttachments }),
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMessage]);

    let userMessagePersisted = false;
    try {
      const uploadedAttachments = await uploadChatAttachments(draftFiles);
      const msgRes = await rpc.threads[':id'].messages.$post({
        param: { id: threadId },
        json: {
          role: 'user',
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

      setMessages((prev) => prev.map((m) => (m.id === tempUserMessage.id ? msgData.message : m)));

      if (isFirstMessageInThread) {
        try {
          const titleSource = trimmedInput || uploadedAttachments[0]?.name || '';
          const title = titleSource.slice(0, 50) + (titleSource.length > 50 ? '...' : '');
          const titleRes = await rpc.threads[':id'].$patch({
            param: { id: threadId },
            json: { title },
          });
          await rpcJson(titleRes);
          onUpdateTitle(title);
        } catch {
          // Title update is best-effort; ignore failures
        }
      }

      const runRes = await rpc.threads[':threadId'].runs.$post({
        param: { threadId },
        json: {
          agent_type: 'default',
          model: selectedModel,
          input: { locale: lang },
        },
      });
      const runData = await rpcJson<{ run: Run }>(runRes);
      setCurrentRun(runData.run);

      startWebSocket(runData.run.id);
    } catch (err) {
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
      setError(err instanceof Error ? err.message : t('networkError'));
    }
  }, [input, attachedFiles, isLoading, threadId, selectedModel, onUpdateTitle, t, lang, uploadChatAttachments, rootRunIdRef, closeWebSocket, abortPendingFetch, currentRunIdRef, lastEventIdRef, resetStreamingState, resetTimeline, setInput, setAttachedFiles, setIsLoading, setMessages, messagesCountRef, setCurrentRun, startWebSocket, syncThreadAfterSendFailure, setError]);

  return {
    sendMessage,
  };
}
