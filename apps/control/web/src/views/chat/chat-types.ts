import type { Run, ThreadHistoryArtifactSummary, ThreadHistoryFocus, ThreadHistoryTaskContext } from '../../types/index.ts';

export type ChatTimelineEventType =
  | 'started'
  | 'run_status'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'progress'
  | 'message'
  | 'completed'
  | 'error'
  | 'cancelled'
  | 'run.failed';

export interface ChatRunMeta {
  runId: string;
  parentRunId: string | null;
  agentType: string;
  status: Run['status'];
}

export type ChatRunArtifactMap = Record<string, ThreadHistoryArtifactSummary[]>;

export interface ChatTimelineEntry {
  key: string;
  seq: number;
  runId: string;
  type: ChatTimelineEventType;
  eventId?: number;
  message: string;
  detail?: string;
  failed?: boolean;
  createdAt: number;
}

export interface ChatStreamingState {
  thinking: string | null;
  toolCalls: Array<{
    id: string;
    name: string;
    arguments: Record<string, unknown>;
    result?: string;
    error?: string;
    status: 'pending' | 'running' | 'completed' | 'error';
    startedAt?: number;
  }>;
  currentMessage: string | null;
}

export type ChatRunMetaMap = Record<string, ChatRunMeta>;

export interface ChatHistoryState {
  artifactsByRunId: ChatRunArtifactMap;
  focus: ThreadHistoryFocus | null;
  taskContext: ThreadHistoryTaskContext | null;
}
