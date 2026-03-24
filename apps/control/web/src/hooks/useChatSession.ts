import { useCallback, useEffect, useRef, useState, type ChangeEvent, type RefObject } from 'react';
import { useI18n, type TranslationKey } from '../providers/I18nProvider';
import { rpc, rpcJson } from '../lib/rpc';
import { DEFAULT_MODEL_ID, FALLBACK_MODELS, type ModelSelectOption } from '../lib/modelCatalog';
import type {
  Message,
  Run,
  ThreadHistoryFocus,
  ThreadHistoryRunNode,
  ThreadHistoryTaskContext,
} from '../types';
import type {
  ChatRunArtifactMap,
  ChatRunMetaMap,
  ChatStreamingState,
  ChatTimelineEntry,
} from '../views/chat/types';
import { useMessagePolling } from './useMessagePolling';
import { useWebSocketConnection, type SessionDiffState } from './useWebSocketConnection';
import { useFileAttachment } from './useFileAttachment';
import { buildChatMessageMetadata, type ChatAttachmentMetadata } from '../views/chat/messageMetadata';

export type { SessionDiffState } from './useWebSocketConnection';

export interface UseChatSessionOptions {
  threadId: string;
  spaceId: string;
  onUpdateTitle: (title: string) => void;
  initialMessage?: string;
  initialModel?: string;
  focusSequence?: number | null;
}

export interface UseChatSessionResult {
  availableModels: ModelSelectOption[];
  selectedModel: string;
  setSelectedModel: (model: string) => void;
  messages: Message[];
  input: string;
  setInput: (value: string) => void;
  isLoading: boolean;
  streaming: ChatStreamingState;
  timelineEntries: ChatTimelineEntry[];
  runMetaById: ChatRunMetaMap;
  artifactsByRunId: ChatRunArtifactMap;
  historyFocus: ThreadHistoryFocus | null;
  taskContext: ThreadHistoryTaskContext | null;
  sessionDiff: SessionDiffState | null;
  dismissSessionDiff: () => void;
  isMerging: boolean;
  handleMerge: () => Promise<void>;
  isCancelling: boolean;
  handleCancel: () => Promise<void>;
  error: string | null;
  setError: (value: string | null) => void;
  attachedFiles: File[];
  addFiles: (files: File[]) => void;
  handleFileSelect: (e: ChangeEvent<HTMLInputElement>) => void;
  removeAttachedFile: (index: number) => void;
  sendMessage: () => Promise<void>;
  messagesEndRef: RefObject<HTMLDivElement>;
}

type ModelOption = string | { id: string; name?: string; description?: string };

function sanitizeAttachmentFileName(name: string): string {
  const trimmed = name.trim();
  const fallback = 'attachment';
  // eslint-disable-next-line no-control-regex
  const sanitized = (trimmed || fallback).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-');
  return sanitized || fallback;
}

function buildChatAttachmentPath(threadId: string, fileName: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  return `/chat-attachments/${threadId}/${timestamp}-${sanitizeAttachmentFileName(fileName)}`;
}

export function useChatSession({
  threadId,
  spaceId,
  onUpdateTitle,
  initialMessage,
  initialModel,
  focusSequence,
}: UseChatSessionOptions): UseChatSessionResult {
  const { t, lang } = useI18n();
  const [input, setInput] = useState(initialMessage ?? '');
  const [selectedModel, setSelectedModel] = useState<string>(initialModel ?? DEFAULT_MODEL_ID);
  const [availableModels, setAvailableModels] = useState<ModelSelectOption[]>([...FALLBACK_MODELS]);

  // Scroll tracking refs (owned by orchestrator because the auto-scroll
  // effect depends on state from both the polling and WebSocket hooks)
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lastAutoScrollMessageCountRef = useRef<number>(0);
  const initialScrollPendingRef = useRef<boolean>(true);
  const autoScrollPinnedRef = useRef<boolean>(true);

  // --- Sub-hooks ---
  const polling = useMessagePolling({ threadId, t });

  const ws = useWebSocketConnection({
    threadId,
    t,
    isMountedRef: polling.isMountedRef,
    fetchMessages: polling.fetchMessages,
    startMessagePolling: polling.startMessagePolling,
    stopMessagePolling: polling.stopMessagePolling,
    setMessages: polling.setMessages,
    setError: polling.setError,
  });

  const files = useFileAttachment({ t, setError: polling.setError });

  const ensureAttachmentFolder = useCallback(async (path: string): Promise<void> => {
    const segments = path.split('/').filter(Boolean);
    let parentPath = '/';

    for (const segment of segments) {
      const res = await rpc.spaces[':spaceId'].storage.folders.$post({
        param: { spaceId },
        json: { name: segment, parent_path: parentPath },
      });

      if (!res.ok) {
        const data = await rpcJson<{ error?: string }>(res).catch(() => ({}));
        const error = data.error || 'Failed to create attachment folder';
        if (!error.includes('already exists')) {
          throw new Error(error);
        }
      }

      parentPath = parentPath === '/' ? `/${segment}` : `${parentPath}/${segment}`;
    }
  }, [spaceId]);

  const uploadChatAttachments = useCallback(async (selectedFiles: File[]): Promise<ChatAttachmentMetadata[]> => {
    if (selectedFiles.length === 0) return [];

    const attachmentRoot = '/chat-attachments';
    const threadFolder = `${attachmentRoot}/${threadId}`;
    await ensureAttachmentFolder(attachmentRoot);
    await ensureAttachmentFolder(threadFolder);

    const uploaded: ChatAttachmentMetadata[] = [];

    for (const file of selectedFiles) {
      const uploadRes = await rpc.spaces[':spaceId'].storage['upload-url'].$post({
        param: { spaceId },
        json: {
          name: `${new Date().toISOString().replace(/[:.]/g, '-')}-${sanitizeAttachmentFileName(file.name)}`,
          parent_path: threadFolder,
          size: file.size,
          mime_type: file.type || undefined,
        },
      });

      if (!uploadRes.ok) {
        const data = await rpcJson<{ error?: string }>(uploadRes).catch(() => ({}));
        throw new Error(data.error || `Failed to prepare upload for ${file.name}`);
      }

      const uploadData = await rpcJson<{
        file_id: string;
        upload_url: string;
      }>(uploadRes);

      const blobRes = await fetch(uploadData.upload_url, {
        method: 'PUT',
        body: file,
        headers: {
          'Content-Type': file.type || 'application/octet-stream',
        },
      });

      if (!blobRes.ok) {
        throw new Error(`Failed to upload ${file.name}`);
      }

      const confirmRes = await rpc.spaces[':spaceId'].storage['confirm-upload'].$post({
        param: { spaceId },
        json: { file_id: uploadData.file_id },
      });

      if (!confirmRes.ok) {
        const data = await rpcJson<{ error?: string }>(confirmRes).catch(() => ({}));
        throw new Error(data.error || `Failed to finalize upload for ${file.name}`);
      }

      const confirmData = await rpcJson<{
        file: {
          id: string;
          path: string;
          name: string;
          mime_type: string | null;
          size: number;
        };
      }>(confirmRes);

      uploaded.push({
        file_id: confirmData.file.id,
        path: confirmData.file.path,
        name: confirmData.file.name,
        mime_type: confirmData.file.mime_type,
        size: confirmData.file.size,
      });
    }

    return uploaded;
  }, [ensureAttachmentFolder, spaceId, threadId]);

  // --- Model fetching ---
  const fetchWorkspaceModels = useCallback(async () => {
    if (!spaceId) return;
    try {
      const res = await rpc.spaces[':spaceId'].model.$get({
        param: { spaceId },
      });
      const data = await rpcJson<{
        ai_model?: string;
        ai_provider?: string;
        model?: string;
        provider?: string;
        available_models: {
          openai: ModelOption[];
          anthropic: ModelOption[];
          google: ModelOption[];
        };
      }>(res);

      const provider = data.ai_provider || data.provider || 'openai';
      let raw: ModelOption[] | undefined;
      if (provider === 'anthropic') {
        raw = data.available_models?.anthropic;
      } else if (provider === 'google') {
        raw = data.available_models?.google;
      } else {
        raw = data.available_models?.openai;
      }

      const models = (raw || [])
        .map((entry) => {
          if (typeof entry === 'string') {
            return { id: entry, label: entry };
          }
          return {
            id: entry.id,
            label: entry.name || entry.id,
            description: entry.description,
          };
        })
        .filter((entry) => entry.id);

      const resolvedModels = models.length > 0 ? models : [...FALLBACK_MODELS];
      setAvailableModels(resolvedModels);

      const resolvedIds = resolvedModels.map((model) => model.id);
      if (initialModel && resolvedIds.includes(initialModel)) {
        setSelectedModel(initialModel);
      } else {
        const desiredModel = data.ai_model || data.model;
        if (desiredModel && resolvedIds.includes(desiredModel)) {
          setSelectedModel(desiredModel);
        } else {
          setSelectedModel((prev) => (resolvedIds.includes(prev) ? prev : resolvedModels[0].id));
        }
      }
    } catch (err) {
      console.error('Failed to fetch workspace models:', err);
      setAvailableModels([...FALLBACK_MODELS]);
    }
  }, [spaceId, initialModel]);

  // --- Send message ---
  const sendMessage = useCallback(async () => {
    const trimmedInput = input.trim();
    if ((!trimmedInput && files.attachedFiles.length === 0) || ws.isLoading) return;

    const isFirstMessageInThread = polling.messagesCountRef.current === 0;
    const draftInput = input;
    const draftFiles = files.attachedFiles;
    const optimisticAttachments: ChatAttachmentMetadata[] = draftFiles.map((file) => ({
      name: file.name,
      path: buildChatAttachmentPath(threadId, file.name),
      mime_type: file.type || null,
      size: file.size,
    }));
    ws.rootRunIdRef.current = null;
    ws.closeWebSocket();
    polling.abortPendingFetch();
    ws.currentRunIdRef.current = null;
    ws.lastEventIdRef.current = 0;
    ws.resetStreamingState();
    ws.resetTimeline();
    setInput('');
    files.setAttachedFiles([]);
    ws.setIsLoading(true);

    const tempUserMessage: Message = {
      id: `temp-${Date.now()}`,
      thread_id: threadId,
      role: 'user',
      content: trimmedInput,
      metadata: buildChatMessageMetadata({ attachments: optimisticAttachments }),
      created_at: new Date().toISOString(),
    };
    polling.setMessages((prev) => [...prev, tempUserMessage]);

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

      polling.setMessages((prev) => prev.map((m) => (m.id === tempUserMessage.id ? msgData.message : m)));

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
        } catch (titleErr) {
          console.warn('Failed to update thread title:', titleErr);
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
      ws.setCurrentRun(runData.run);

      ws.startWebSocket(runData.run.id);
    } catch (err) {
      ws.setIsLoading(false);
      ws.setCurrentRun(null);
      ws.resetStreamingState();
      if (!userMessagePersisted) {
        polling.setMessages((prev) => prev.filter((m) => m.id !== tempUserMessage.id));
        setInput(draftInput);
        files.setAttachedFiles(draftFiles);
      } else {
        polling.setMessages((prev) => prev.filter((m) => m.id !== tempUserMessage.id));
        await ws.syncThreadAfterSendFailure();
      }
      polling.setError(err instanceof Error ? err.message : t('networkError'));
    }
  }, [input, ws, polling, files, threadId, selectedModel, onUpdateTitle, t, lang, uploadChatAttachments]);

  // --- Initialization effect ---
  useEffect(() => {
    polling.isMountedRef.current = true;

    ws.rootRunIdRef.current = null;
    ws.closeWebSocket();
    ws.currentRunIdRef.current = null;
    ws.lastEventIdRef.current = 0;
    ws.setSessionDiff(null);
    polling.setMessages([]);
    ws.setIsLoading(false);
    ws.setCurrentRun(null);
    ws.setIsCancelling(false);
    ws.resetStreamingState();
    ws.resetTimeline();
    polling.setError(null);
    setInput(initialMessage ?? '');
    files.setAttachedFiles([]);
    initialScrollPendingRef.current = true;
    autoScrollPinnedRef.current = true;
    lastAutoScrollMessageCountRef.current = 0;

    const init = async () => {
      try {
        const limit = focusSequence != null ? 200 : 100;
        const offset = focusSequence != null
          ? Math.max(0, focusSequence - Math.floor(limit / 2))
          : 0;
        const res = await rpc.threads[':id'].history.$get({
          param: { id: threadId },
          query: { limit: String(limit), offset: String(offset) },
        });
        const data = await rpcJson<{
          messages: Message[];
          runs: ThreadHistoryRunNode[];
          focus: ThreadHistoryFocus | null;
          activeRun: Run | null;
          pendingSessionDiff: {
            sessionId: string;
            sessionStatus: string;
            git_mode: boolean;
          } | null;
          taskContext: ThreadHistoryTaskContext | null;
        }>(res);

        if (!polling.isMountedRef.current) return;

        polling.setMessages(data.messages);
        ws.applyHistorySnapshot({
          runs: data.runs || [],
          focus: data.focus,
          taskContext: data.taskContext,
        });

        if (data.activeRun) {
          ws.setIsLoading(true);
          ws.setCurrentRun(data.activeRun);
          ws.startWebSocket(data.activeRun.id);
        }

        void ws.loadPendingSessionDiff(data.pendingSessionDiff);
      } catch (err) {
        console.error('Failed to initialize chat session:', err);
        polling.setError(t('failedToLoad' as TranslationKey) || 'Failed to load messages');
      }
    };
    init();

    return () => {
      polling.isMountedRef.current = false;
      polling.abortPendingFetch();
      ws.closeWebSocket();
      ws.currentRunIdRef.current = null;
      ws.lastEventIdRef.current = 0;
      ws.rootRunIdRef.current = null;
    };
  }, [threadId, focusSequence, ws.resetStreamingState, ws.resetTimeline]);

  // --- Fetch workspace models ---
  useEffect(() => {
    fetchWorkspaceModels();
  }, [fetchWorkspaceModels]);

  // --- Scroll pinning: track whether user is near the bottom ---
  useEffect(() => {
    const anchor = messagesEndRef.current;
    const scrollContainer = anchor?.parentElement?.parentElement;
    if (!(scrollContainer instanceof HTMLElement)) {
      return;
    }

    function updatePinnedState(): void {
      const distanceFromBottom =
        (scrollContainer as HTMLElement).scrollHeight -
        (scrollContainer as HTMLElement).scrollTop -
        (scrollContainer as HTMLElement).clientHeight;
      autoScrollPinnedRef.current = distanceFromBottom <= 96;
    }

    autoScrollPinnedRef.current = true;
    scrollContainer.addEventListener('scroll', updatePinnedState, { passive: true });
    return () => {
      scrollContainer.removeEventListener('scroll', updatePinnedState);
    };
  }, [threadId]);

  // --- Auto-scroll when messages change or streaming updates ---
  useEffect(() => {
    const nextCount = polling.messages.length;
    if (initialScrollPendingRef.current) {
      if (nextCount === 0) {
        return;
      }
      initialScrollPendingRef.current = false;
      lastAutoScrollMessageCountRef.current = nextCount;
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      return;
    }
    if (!autoScrollPinnedRef.current) {
      lastAutoScrollMessageCountRef.current = nextCount;
      return;
    }
    const behavior: ScrollBehavior =
      nextCount > lastAutoScrollMessageCountRef.current ? 'smooth' : 'auto';
    lastAutoScrollMessageCountRef.current = nextCount;
    messagesEndRef.current?.scrollIntoView({ behavior });
  }, [polling.messages.length, ws.streaming.currentMessage, ws.streaming.thinking, ws.streaming.toolCalls.length]);

  return {
    availableModels,
    selectedModel,
    setSelectedModel,
    messages: polling.messages,
    input,
    setInput,
    isLoading: ws.isLoading,
    streaming: ws.streaming,
    timelineEntries: ws.timelineEntries,
    runMetaById: ws.runMetaById,
    artifactsByRunId: ws.artifactsByRunId,
    historyFocus: ws.historyFocus,
    taskContext: ws.taskContext,
    sessionDiff: ws.sessionDiff,
    dismissSessionDiff: ws.dismissSessionDiff,
    isMerging: ws.isMerging,
    handleMerge: ws.handleMerge,
    isCancelling: ws.isCancelling,
    handleCancel: ws.handleCancel,
    error: polling.error,
    setError: polling.setError,
    attachedFiles: files.attachedFiles,
    addFiles: files.addFiles,
    handleFileSelect: files.handleFileSelect,
    removeAttachedFile: files.removeAttachedFile,
    sendMessage,
    messagesEndRef,
  };
}
