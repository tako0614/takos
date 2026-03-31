import { and, asc, desc, eq } from 'drizzle-orm';
import type { RunStatus } from '../../../shared/types/index.ts';
import { throwIfAborted } from 'takos-common/abort';
import { getDb, runs, artifacts, threads, messages } from '../../../infra/db/index.ts';
import { createThreadRun } from '../../services/execution/run-creation.ts';
import { resolveRunModel } from '../../services/runs/create-thread-run-validation.ts';
import { createThread, updateThreadStatus } from '../../services/threads/thread-service.ts';
import { getSpaceLocale } from '../../services/identity/locale.ts';
import {
  buildDelegationPacket,
} from '../../services/agent/delegation.ts';
import type { ToolDefinition, ToolHandler } from '../tool-definitions.ts';
import { safeJsonParseOrDefault } from '../../../shared/utils/index.ts';
import { logWarn } from '../../../shared/utils/logger.ts';

const TERMINAL_RUN_STATUSES = new Set<RunStatus>(['completed', 'failed', 'cancelled']);
const DEFAULT_WAIT_TIMEOUT_MS = 30_000;
const MAX_WAIT_TIMEOUT_MS = 240_000;
const WAIT_POLL_INTERVAL_MS = 1_000;

type ChildRunRow = {
  id: string;
  parentRunId: string | null;
  threadId: string;
  childThreadId: string | null;
  rootThreadId: string | null;
  accountId: string;
  status: string;
  output: string | null;
  error: string | null;
  completedAt: string | null;
  createdAt: string;
};

type ArtifactSummary = {
  id: string;
  type: string;
  title: string | null;
  created_at: string;
};

export const SPAWN_AGENT: ToolDefinition = {
  name: 'spawn_agent',
  description:
    'Spawn a sub-agent to execute an independent delegated task concurrently in a dedicated child thread. ' +
    'Prefer using this early for meaningful parallel side work, then use wait_agent when the parent run needs the child result.',
  category: 'agent',
  parameters: {
    type: 'object',
    properties: {
      task: {
        type: 'string',
        description: 'Clear, self-contained instructions for the sub-agent to execute.',
      },
      goal: {
        type: 'string',
        description: 'Higher-level goal for the delegated work (optional).',
      },
      deliverable: {
        type: 'string',
        description: 'Expected output or artifact from the delegated work (optional).',
      },
      constraints: {
        type: 'array',
        description: 'Constraints the sub-agent must respect (optional).',
        items: {
          type: 'string',
          description: 'Constraint string',
        },
      },
      context: {
        type: 'array',
        description: 'Relevant findings or facts to pass explicitly to the sub-agent (optional).',
        items: {
          type: 'string',
          description: 'Context item',
        },
      },
      acceptance_criteria: {
        type: 'array',
        description: 'Checks the delegated result should satisfy (optional).',
        items: {
          type: 'string',
          description: 'Acceptance criterion',
        },
      },
      product_hint: {
        type: 'string',
        description: 'Product hint for the delegated work (optional).',
        enum: ['takos', 'yurucommu', 'roadtome'],
      },
      locale: {
        type: 'string',
        description: 'Preferred locale for the delegated work (optional).',
        enum: ['ja', 'en'],
      },
      agent_type: {
        type: 'string',
        description: 'Agent type for the sub-agent (optional, default: "default")',
      },
      model: {
        type: 'string',
        description: 'LLM model for the sub-agent (optional, inherits workspace default if omitted)',
      },
    },
    required: ['task'],
  },
};

export const WAIT_AGENT: ToolDefinition = {
  name: 'wait_agent',
  description:
    'Wait for a child sub-agent run spawned by the current run. ' +
    'Returns terminal status and summarized results when complete, or a timeout status if still running.',
  category: 'agent',
  parameters: {
    type: 'object',
    properties: {
      run_id: {
        type: 'string',
        description: 'Child run ID returned by spawn_agent',
      },
      timeout_ms: {
        type: 'number',
        description: `How long to wait in milliseconds (optional, default: ${DEFAULT_WAIT_TIMEOUT_MS}, max: ${MAX_WAIT_TIMEOUT_MS})`,
      },
    },
    required: ['run_id'],
  },
};

function normalizeWaitTimeout(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_WAIT_TIMEOUT_MS;
  }
  return Math.min(Math.floor(parsed), MAX_WAIT_TIMEOUT_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractFinalResponse(output: string | null): string | null {
  if (!output) {
    return null;
  }

  const parsed = safeJsonParseOrDefault<unknown>(output, null);
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    const response = (parsed as Record<string, unknown>).response;
    if (typeof response === 'string' && response.trim()) {
      return response;
    }
  }

  return output;
}

async function loadChildRun(
  childRunId: string,
  context: Parameters<ToolHandler>[1],
): Promise<{ run: ChildRunRow; artifacts: ArtifactSummary[] }> {
  const db = getDb(context.db);
  const childRun = await db.select({
    id: runs.id,
    parentRunId: runs.parentRunId,
    threadId: runs.threadId,
    childThreadId: runs.childThreadId,
    rootThreadId: runs.rootThreadId,
    accountId: runs.accountId,
    status: runs.status,
    output: runs.output,
    error: runs.error,
    completedAt: runs.completedAt,
    createdAt: runs.createdAt,
  }).from(runs)
    .where(and(
      eq(runs.id, childRunId),
      eq(runs.parentRunId, context.runId),
      eq(runs.accountId, context.spaceId),
    ))
    .get();

  if (!childRun) {
    throw new Error(`Child run not found or not owned by this parent run: ${childRunId}`);
  }

  const childArtifacts = await db.select({
    id: artifacts.id,
    type: artifacts.type,
    title: artifacts.title,
    created_at: artifacts.createdAt,
  }).from(artifacts)
    .where(eq(artifacts.runId, childRunId))
    .orderBy(asc(artifacts.createdAt), asc(artifacts.id))
    .all();

  return {
    run: childRun,
    artifacts: childArtifacts.map((artifact) => ({
      ...artifact,
      created_at: artifact.created_at,
    })),
  };
}

function buildWaitAgentResponse(result: { run: ChildRunRow; artifacts: ArtifactSummary[] }, timedOut: boolean): string {
  const terminal = TERMINAL_RUN_STATUSES.has(result.run.status as RunStatus);
  return JSON.stringify({
    run_id: result.run.id,
    parent_run_id: result.run.parentRunId,
    child_thread_id: result.run.childThreadId,
    root_thread_id: result.run.rootThreadId ?? result.run.threadId,
    status: result.run.status,
    timed_out: timedOut,
    completed_at: result.run.completedAt ? result.run.completedAt : null,
    final_response: terminal ? extractFinalResponse(result.run.output) : null,
    error: terminal ? result.run.error : null,
    artifacts: result.artifacts,
  }, null, 2);
}

function parseInputObject(input: string | null | undefined): Record<string, unknown> {
  if (!input) {
    return {};
  }
  const parsed = safeJsonParseOrDefault<unknown>(input, {});
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return {};
}

export const spawnAgentHandler: ToolHandler = async (args, context) => {
  const task = args.task as string;
  const agentType = (args.agent_type as string | undefined) || 'default';
  const requestedModel = args.model as string | undefined;

  if (!task || typeof task !== 'string' || task.trim().length === 0) {
    throw new Error('task is required and must be a non-empty string');
  }

  const db = getDb(context.db);
  const model = await resolveRunModel(context.db, context.spaceId, requestedModel);
  const [parentThread, latestUserMessage, parentRunRow, spaceLocale] = await Promise.all([
    db.select({
      title: threads.title,
      summary: threads.summary,
      keyPoints: threads.keyPoints,
      locale: threads.locale,
    }).from(threads).where(eq(threads.id, context.threadId)).get(),
    db.select({
      content: messages.content,
    }).from(messages).where(and(
      eq(messages.threadId, context.threadId),
      eq(messages.role, 'user'),
    )).orderBy(desc(messages.sequence)).get(),
    db.select({
      input: runs.input,
      rootThreadId: runs.rootThreadId,
    }).from(runs).where(eq(runs.id, context.runId)).get(),
    getSpaceLocale(context.db, context.spaceId),
  ]);

  let threadKeyPoints: string[] = [];
  try {
    const parsed = safeJsonParseOrDefault<unknown>(parentThread?.keyPoints ?? '[]', []);
    if (Array.isArray(parsed)) {
      threadKeyPoints = parsed.map((item) => String(item).trim()).filter(Boolean);
    }
  } catch {
    threadKeyPoints = [];
  }

  const parentRunInput = parseInputObject(parentRunRow?.input);
  const { packet, observability } = buildDelegationPacket({
    task,
    goal: typeof args.goal === 'string' ? args.goal : null,
    deliverable: typeof args.deliverable === 'string' ? args.deliverable : null,
    constraints: args.constraints as string[] | undefined,
    context: args.context as string[] | undefined,
    acceptanceCriteria: args.acceptance_criteria as string[] | undefined,
    productHint: typeof args.product_hint === 'string' ? args.product_hint : null,
    locale: typeof args.locale === 'string' ? args.locale : null,
    parentRunId: context.runId,
    parentThreadId: context.threadId,
    rootThreadId: parentRunRow?.rootThreadId ?? context.threadId,
    latestUserMessage: latestUserMessage?.content ?? null,
    parentRunInput,
    threadSummary: parentThread?.summary ?? null,
    threadKeyPoints,
    threadLocale: parentThread?.locale ?? null,
    spaceLocale,
  });

  const childThread = await createThread(context.db, context.spaceId, {
    title: `Sub-agent: ${task.trim().slice(0, 80)}`,
    locale: packet.locale,
  });
  if (!childThread) {
    throw new Error('Cannot spawn sub-agent: child thread could not be created');
  }

  const spawnResult = await createThreadRun(context.env, {
    userId: context.userId,
    threadId: childThread.id,
    agentType,
    input: {
      task,
      goal: packet.goal,
      deliverable: packet.deliverable,
      locale: packet.locale,
      product_hint: packet.product_hint,
      delegation: packet,
      delegation_observability: observability,
    },
    parentRunId: context.runId,
    model,
  });

  if (!spawnResult.ok) {
    try {
      await updateThreadStatus(context.db, childThread.id, 'archived');
    } catch (archiveError) {
      logWarn(`Failed to archive orphan child thread ${childThread.id}`, { module: 'agent_tools', detail: archiveError });
    }
    throw new Error(`Cannot spawn sub-agent: ${spawnResult.error}`);
  }
  if (!spawnResult.run) {
    throw new Error('Cannot spawn sub-agent: run record was not created');
  }

  return JSON.stringify({
    run_id: spawnResult.run.id,
    child_thread_id: childThread.id,
    status: spawnResult.run.status,
    parent_run_id: context.runId,
    task,
    agent_type: agentType,
    model,
    delegation: packet,
    delegation_observability: observability,
    message:
      `Sub-agent spawned successfully (run_id: ${spawnResult.run.id}). ` +
      'Use wait_agent if you need the child result before continuing.',
  }, null, 2);
};

export const waitAgentHandler: ToolHandler = async (args, context) => {
  const runId = typeof args.run_id === 'string' ? args.run_id.trim() : '';
  if (!runId) {
    throw new Error('run_id is required');
  }

  const timeoutMs = normalizeWaitTimeout(args.timeout_ms);
  const deadline = Date.now() + timeoutMs;

  while (true) {
    throwIfAborted(context.abortSignal, 'wait_agent');
    const result = await loadChildRun(runId, context);
    if (TERMINAL_RUN_STATUSES.has(result.run.status as RunStatus)) {
      return buildWaitAgentResponse(result, false);
    }

    if (Date.now() >= deadline) {
      return buildWaitAgentResponse(result, true);
    }

    throwIfAborted(context.abortSignal, 'wait_agent');
    await sleep(Math.min(WAIT_POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
  }
};

export const AGENT_TOOLS: ToolDefinition[] = [
  SPAWN_AGENT,
  WAIT_AGENT,
];

export const AGENT_HANDLERS: Record<string, ToolHandler> = {
  spawn_agent: spawnAgentHandler,
  wait_agent: waitAgentHandler,
};
