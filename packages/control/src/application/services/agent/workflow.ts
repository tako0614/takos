import type { Env } from '../../../shared/types';
import type { AgentMessage } from './types';
import type { SnapshotTree } from '../sync/types';
import { createLLMClient } from './llm';
import { SnapshotManager } from '../sync/snapshot';
import { generateId, now } from '../../../shared/utils';
import { getDb, pullRequests, prReviews, sessions, accounts, runs, branches, files } from '../../../infra/db';
import { eq, and, sql } from 'drizzle-orm';
import { buildPRDiffText } from '../pull-requests/ai-review';
import { callRuntimeRequest } from '../execution/runtime';
import { logError } from '../../../shared/utils/logger';

// ── Public types ────────────────────────────────────────────────────────

export interface TaskStep {
  id: string;
  type: 'tool_call' | 'code_change' | 'review' | 'commit' | 'pr_create' | 'pr_merge';
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  result?: string;
  error?: string;
}

export interface TaskPlan {
  type: 'conversation' | 'tool_only' | 'code_change' | 'composite';
  tools?: string[];
  needsRepo?: boolean;
  repoId?: string;
  needsRuntime?: boolean;
  usePR?: boolean;
  needsReview?: boolean;
  reviewType?: 'self' | 'separate_ai';
  commitMessage?: string;
  steps?: TaskStep[];
  reasoning?: string;
}

export interface WorkflowContext {
  env: Env;
  spaceId: string;
  userId: string;
  threadId: string;
  runId: string;
  sessionId?: string;
  repoId?: string;
}

export interface WorkflowResult {
  success: boolean;
  message: string;
  prId?: string;
  commitHash?: string;
  reviewResult?: ReviewResult;
  steps?: TaskStep[];
}

export interface ReviewResult {
  status: 'approved' | 'changes_requested' | 'commented';
  summary: string;
  issues: ReviewIssue[];
  suggestions: string[];
}

export interface ReviewIssue {
  severity: 'error' | 'warning' | 'info';
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
}

// ── Shared helpers ──────────────────────────────────────────────────────

/** Valid task plan types. */
const VALID_PLAN_TYPES: ReadonlySet<string> = new Set([
  'conversation', 'tool_only', 'code_change', 'composite',
]);

/** Strip markdown code fences from an LLM response and return the JSON body. */
function extractJsonFromLLMResponse(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('{')) return trimmed;
  return trimmed.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
}

/** Response shape returned by the runtime snapshot endpoint. */
interface RuntimeSnapshotResponse {
  files: Array<{ path: string; content: string; size: number }>;
}

// ── Prompts ─────────────────────────────────────────────────────────────

const TASK_ANALYSIS_PROMPT = `You are a task analyzer for an AI agent system. Analyze the user's task and determine the best approach to complete it.

Available tools: {tools}

Analyze the task and return a JSON object with:
- type: "conversation" | "tool_only" | "code_change" | "composite"
  - conversation: Simple Q&A, explanations, discussions
  - tool_only: Tasks that only need tool calls (web search, file reading, etc.)
  - code_change: Tasks requiring file modifications
  - composite: Complex tasks needing multiple approaches
- tools: Array of tool names that might be needed
- needsRepo: Boolean - does this task involve a git repository?
- needsRuntime: Boolean - does this need runtime container execution (npm, build, etc.)?
- usePR: Boolean - should changes go through a PR workflow?
- needsReview: Boolean - should changes be reviewed before merging?
- reviewType: "self" | "separate_ai" - who reviews (self = same conversation, separate_ai = new AI session)
- commitMessage: Suggested commit message if applicable
- reasoning: Brief explanation of your decision

Respond ONLY with valid JSON, no markdown or other text.

User task: {task}`;

const REVIEW_PROMPT = `You are a code reviewer. Review the following changes and provide feedback.

Changes (diff):
{diff}

Original task:
{task}

Provide a thorough review including:
1. Overall assessment (approved, changes_requested, or commented)
2. Any bugs or issues found
3. Code quality concerns
4. Security considerations
5. Suggestions for improvement

Return a JSON object with:
- status: "approved" | "changes_requested" | "commented"
- summary: Brief overall assessment
- issues: Array of { severity: "error"|"warning"|"info", file?: string, line?: number, message: string, suggestion?: string }
- suggestions: Array of improvement suggestions

Respond ONLY with valid JSON.`;

// ── Task analysis ───────────────────────────────────────────────────────

export async function analyzeTask(
  task: string,
  context: {
    spaceId: string;
    userId: string;
    tools: string[];
    apiKey: string;
    model?: string;
  }
): Promise<TaskPlan> {
  const llm = createLLMClient(context.apiKey, context.model ? { model: context.model } : undefined);

  const prompt = TASK_ANALYSIS_PROMPT
    .replace('{tools}', context.tools.join(', '))
    .replace('{task}', task);

  const messages: AgentMessage[] = [
    { role: 'system', content: 'You are a task analyzer. Return only valid JSON.' },
    { role: 'user', content: prompt },
  ];

  try {
    const response = await llm.chat(messages);
    const plan = JSON.parse(extractJsonFromLLMResponse(response.content)) as TaskPlan;

    if (!VALID_PLAN_TYPES.has(plan.type)) {
      plan.type = 'conversation';
    }

    plan.tools = plan.tools || [];
    plan.needsRepo = plan.needsRepo ?? false;
    plan.needsRuntime = plan.needsRuntime ?? false;
    plan.usePR = plan.usePR ?? false;
    plan.needsReview = plan.needsReview ?? false;
    plan.reviewType = plan.reviewType || 'self';

    return plan;
  } catch (error) {
    logError('Task analysis failed', error, { module: 'services/agent/workflow' });
    return {
      type: 'conversation',
      tools: [],
      reasoning: 'Analysis failed, defaulting to conversation',
    };
  }
}

// ── Code-change workflow ────────────────────────────────────────────────

export async function executeCodeChangeWorkflow(
  task: string,
  plan: TaskPlan,
  context: WorkflowContext
): Promise<WorkflowResult> {
  const steps: TaskStep[] = [];

  try {
    let branchName: string | undefined;
    if (plan.usePR && plan.repoId) {
      branchName = `ai/${generateId(8)}-${Date.now()}`;

      steps.push({
        id: generateId(),
        type: 'code_change',
        description: `Create branch: ${branchName}`,
        status: 'completed',
        result: branchName,
      });
    }

    steps.push({
      id: generateId(),
      type: 'code_change',
      description: 'Execute code changes',
      status: 'pending',
    });

    const commitStep: TaskStep = {
      id: generateId(),
      type: 'commit',
      description: plan.commitMessage || 'AI-generated changes',
      status: 'pending',
    };
    steps.push(commitStep);

    let prId: string | undefined;
    if (plan.usePR && plan.repoId) {
      const prStep: TaskStep = {
        id: generateId(),
        type: 'pr_create',
        description: `Create PR for ${branchName}`,
        status: 'pending',
      };
      steps.push(prStep);

      prId = await createPullRequest(context, {
        repoId: plan.repoId,
        title: plan.commitMessage || task.substring(0, 100),
        description: `AI-generated changes for: ${task}`,
        headBranch: branchName!,
        baseBranch: 'main',
      });

      prStep.status = 'completed';
      prStep.result = prId;
    }

    let reviewResult: ReviewResult | undefined;
    if (plan.needsReview && prId) {
      const reviewStep: TaskStep = {
        id: generateId(),
        type: 'review',
        description: `Review PR (${plan.reviewType})`,
        status: 'running',
      };
      steps.push(reviewStep);

      reviewResult = await executeReview(
        context,
        prId,
        plan.reviewType || 'self'
      );

      reviewStep.status = 'completed';
      reviewStep.result = reviewResult.status;
    }

    if (prId && (!plan.needsReview || reviewResult?.status === 'approved')) {
      const mergeStep: TaskStep = {
        id: generateId(),
        type: 'pr_merge',
        description: 'Merge PR',
        status: 'pending',
      };
      steps.push(mergeStep);

      await mergePullRequest(context, prId);
      mergeStep.status = 'completed';
    }

    return {
      success: true,
      message: plan.usePR
        ? `Changes committed via PR ${prId}`
        : 'Changes committed directly',
      prId,
      reviewResult,
      steps,
    };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    for (const step of steps) {
      if (step.status === 'pending' || step.status === 'running') {
        step.status = 'failed';
        step.error = errorMessage;
      }
    }

    return {
      success: false,
      message: `Workflow failed: ${errorMessage}`,
      steps,
    };
  }
}

// ── Review ──────────────────────────────────────────────────────────────

export async function executeReview(
  context: WorkflowContext,
  prId: string,
  reviewType: 'self' | 'separate_ai'
): Promise<ReviewResult> {
  const { env } = context;
  const apiKey = env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OpenAI API key not configured for review');
  }

  const db = getDb(env.DB);

  const pr = await db.select().from(pullRequests).where(eq(pullRequests.id, prId)).get();

  if (!pr) {
    throw new Error(`PR not found: ${prId}`);
  }

  const diff = await getPRDiff(context, pr);
  const prompt = REVIEW_PROMPT
    .replace('{diff}', diff)
    .replace('{task}', pr.description || pr.title);

  const llm = createLLMClient(apiKey);
  const messages: AgentMessage[] = [
    { role: 'system', content: 'You are a code reviewer. Return only valid JSON.' },
    { role: 'user', content: prompt },
  ];

  const response = await llm.chat(messages);

  let reviewResult: ReviewResult;
  try {
    reviewResult = JSON.parse(extractJsonFromLLMResponse(response.content)) as ReviewResult;
  } catch (parseError) {
    logError('Failed to parse review JSON', parseError, { module: 'services/agent/workflow' });
    reviewResult = {
      status: 'commented',
      summary: 'Review parsing failed - manual review recommended',
      issues: [{
        severity: 'warning',
        message: 'AI review response could not be parsed',
      }],
      suggestions: [],
    };
  }

  const reviewId = generateId();
  const timestamp = now();

  await db.insert(prReviews).values({
    id: reviewId,
    prId,
    reviewerType: 'ai',
    reviewerId: null,
    status: reviewResult.status,
    body: reviewResult.summary,
    analysis: JSON.stringify({ issues: reviewResult.issues, suggestions: reviewResult.suggestions }),
    createdAt: timestamp,
  });

  return reviewResult;
}

// ── PR helpers ──────────────────────────────────────────────────────────

async function createPullRequest(
  context: WorkflowContext,
  options: {
    repoId: string;
    title: string;
    description: string;
    headBranch: string;
    baseBranch: string;
  }
): Promise<string> {
  const { env, userId, runId } = context;
  const db = getDb(env.DB);
  const timestamp = now();
  const prId = generateId();

  const MAX_RETRIES = 5;
  const baseDelayMs = 10;
  const maxDelayMs = 500;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const maxResult = await db.select({
        maxNumber: sql<number>`max(${pullRequests.number})`,
      }).from(pullRequests).where(eq(pullRequests.repoId, options.repoId)).get();

      const nextNumber = (maxResult?.maxNumber ?? 0) + 1;

      await db.insert(pullRequests).values({
        id: prId,
        repoId: options.repoId,
        number: nextNumber,
        title: options.title,
        description: options.description,
        headBranch: options.headBranch,
        baseBranch: options.baseBranch,
        status: 'open',
        authorType: 'agent',
        authorId: userId,
        runId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      return prId;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const isRetryable = errorMessage.includes('UNIQUE constraint') ||
                          errorMessage.includes('SQLITE_BUSY');

      if (isRetryable && attempt < MAX_RETRIES - 1) {
        const exponentialDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
        const jitter = Math.random() * exponentialDelay;
        const totalDelay = Math.floor(exponentialDelay + jitter);
        await new Promise(resolve => setTimeout(resolve, totalDelay));
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Failed to create PR after ${MAX_RETRIES} attempts due to number conflicts`);
}

async function getPRDiff(
  context: WorkflowContext,
  pr: { repoId: string; number: number; title: string; headBranch: string; baseBranch: string }
): Promise<string> {
  let diffResult: Awaited<ReturnType<typeof buildPRDiffText>>;
  try {
    diffResult = await buildPRDiffText(context.env, pr.repoId, pr.baseBranch, pr.headBranch);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to build PR diff: ${reason}`);
  }

  if (!diffResult.diffText) {
    const skippedInfo = diffResult.skipped.length > 0
      ? ` (skipped: ${diffResult.skipped.join(', ')})`
      : '';
    throw new Error(`No textual diff available for PR #${pr.number}${skippedInfo}`);
  }

  return [
    `PR #${pr.number}: ${pr.title}`,
    `Base: ${pr.baseBranch}`,
    `Head: ${pr.headBranch}`,
    `Changed files: ${diffResult.totalFiles}`,
    diffResult.skipped.length > 0 ? `Skipped: ${diffResult.skipped.join(', ')}` : '',
    '',
    diffResult.diffText,
  ].filter(Boolean).join('\n');
}

async function mergePullRequest(
  context: WorkflowContext,
  prId: string
): Promise<void> {
  const { env } = context;
  const db = getDb(env.DB);
  const pullRequest = await db.select({
    id: pullRequests.id,
    repoId: pullRequests.repoId,
    status: pullRequests.status,
    headBranch: pullRequests.headBranch,
    baseBranch: pullRequests.baseBranch,
    runId: pullRequests.runId,
  }).from(pullRequests).where(eq(pullRequests.id, prId)).get();

  if (!pullRequest) {
    throw new Error(`PR not found: ${prId}`);
  }

  if (pullRequest.status === 'merged') {
    return;
  }

  const timestamp = now();

  // Resolve sessionId from the associated run
  let sessionId: string | null = null;
  if (pullRequest.runId) {
    const runRow = await db.select({ sessionId: runs.sessionId }).from(runs)
      .where(eq(runs.id, pullRequest.runId)).get();
    sessionId = runRow?.sessionId ?? null;
  }

  await db.update(pullRequests).set({
    status: 'merged',
    mergedAt: timestamp,
    updatedAt: timestamp,
  }).where(eq(pullRequests.id, prId));

  if (sessionId) {
    const session = await db.select({
      id: sessions.id,
      accountId: sessions.accountId,
      headSnapshotId: sessions.headSnapshotId,
    }).from(sessions).where(eq(sessions.id, sessionId)).get();

    if (session) {
      if (session.headSnapshotId) {
        await db.update(accounts).set({
          headSnapshotId: session.headSnapshotId,
          updatedAt: timestamp,
        }).where(eq(accounts.id, session.accountId));
      }

      await db.update(sessions).set({
        status: 'merged',
        branch: null,
        updatedAt: timestamp,
      }).where(eq(sessions.id, session.id));

      if (pullRequest.headBranch !== pullRequest.baseBranch) {
        await db.delete(branches).where(
          and(
            eq(branches.repoId, pullRequest.repoId),
            eq(branches.name, pullRequest.headBranch),
            eq(branches.isDefault, false),
          )
        );
      }
    }
  }
}

// ── Orchestrator ────────────────────────────────────────────────────────

export async function orchestrateWorkflow(
  task: string,
  context: WorkflowContext & { apiKey: string; tools: string[]; model?: string }
): Promise<WorkflowResult> {
  const plan = await analyzeTask(task, {
    spaceId: context.spaceId,
    userId: context.userId,
    tools: context.tools,
    apiKey: context.apiKey,
    model: context.model,
  });

  switch (plan.type) {
    case 'conversation':
      return {
        success: true,
        message: 'Task handled as conversation',
      };

    case 'tool_only':
      return {
        success: true,
        message: 'Task requires tool execution',
        steps: (plan.tools || []).map(tool => ({
          id: generateId(),
          type: 'tool_call' as const,
          description: `Execute tool: ${tool}`,
          status: 'pending' as const,
        })),
      };

    case 'code_change':
    case 'composite':
      return await executeCodeChangeWorkflow(task, plan, context);

    default:
      return {
        success: false,
        message: `Unknown plan type: ${plan.type}`,
      };
  }
}

// ── Session management ──────────────────────────────────────────────────

export async function startWorkflowSession(
  context: WorkflowContext,
  needsRuntime: boolean
): Promise<{ sessionId: string; snapshotId: string }> {
  const { env, spaceId, runId } = context;
  const db = getDb(env.DB);
  const timestamp = now();

  const workspace = await db.select({
    headSnapshotId: accounts.headSnapshotId,
  }).from(accounts).where(eq(accounts.id, spaceId)).get();

  const baseSnapshotId = workspace?.headSnapshotId || '';
  const sessionId = generateId();

  await db.insert(sessions).values({
    id: sessionId,
    accountId: spaceId,
    baseSnapshotId,
    status: 'running',
    createdAt: timestamp,
    updatedAt: timestamp,
  });

  await db.update(runs).set({ sessionId }).where(eq(runs.id, runId));

  if (needsRuntime) {
    if (!env.RUNTIME_HOST) {
      throw new Error('RUNTIME_HOST binding is required when needsRuntime is true');
    }

    const snapshotManager = new SnapshotManager(env, spaceId);
    const tree = baseSnapshotId
      ? await snapshotManager.getTree(baseSnapshotId)
      : await snapshotManager.createTreeFromWorkspace();

    const files: Array<{ path: string; content: string }> = [];
    const blobFetcher = snapshotManager.createBlobFetcher();

    for (const [path, entry] of Object.entries(tree)) {
      const content = await blobFetcher(entry.hash);
      if (content) {
        files.push({ path, content });
      }
    }

    await callRuntimeRequest(env, '/session/init', {
      method: 'POST',
      body: {
        session_id: sessionId,
        space_id: spaceId,
        files,
      },
    });
  }

  return { sessionId, snapshotId: baseSnapshotId };
}

export async function commitWorkflowSession(
  context: WorkflowContext,
  message: string
): Promise<{ snapshotId: string; hash?: string }> {
  const { env, spaceId, sessionId } = context;
  const db = getDb(env.DB);

  if (!sessionId) {
    throw new Error('No session to commit');
  }

  const timestamp = now();
  const snapshotManager = new SnapshotManager(env, spaceId);

  const session = await db.select({
    baseSnapshotId: sessions.baseSnapshotId,
  }).from(sessions).where(eq(sessions.id, sessionId)).get();

  if (!session) {
    throw new Error(`Session not found: ${sessionId}`);
  }

  const tree: SnapshotTree = {};

  if (env.RUNTIME_HOST) {
    const BLOB_CHUNK_SIZE = 50;

    try {
      const response = await callRuntimeRequest(env, '/session/snapshot', {
        method: 'POST',
        body: {
          session_id: sessionId,
          space_id: spaceId,
        },
      });

      if (response.ok) {
        const snapshot = await response.json() as RuntimeSnapshotResponse;

        for (let i = 0; i < snapshot.files.length; i += BLOB_CHUNK_SIZE) {
          const chunk = snapshot.files.slice(i, i + BLOB_CHUNK_SIZE);

          for (const file of chunk) {
            const { hash, size } = await snapshotManager.writeBlob(file.content);
            tree[file.path] = {
              hash,
              size,
              mode: 0o644,
              type: 'file',
            };
            (file as { content: string | null }).content = null;
          }
        }

        snapshot.files.length = 0;
      }
    } catch (error) {
      logError('Failed to get runtime snapshot', error, { module: 'services/agent/workflow' });
    }
  }

  const newSnapshot = await snapshotManager.createSnapshot(
    tree,
    session.baseSnapshotId ? [session.baseSnapshotId] : [],
    message,
    'ai'
  );

  await db.update(sessions).set({ status: 'stopped', headSnapshotId: newSnapshot.id, updatedAt: timestamp })
    .where(eq(sessions.id, sessionId));
  await db.update(accounts).set({ headSnapshotId: newSnapshot.id, updatedAt: timestamp })
    .where(eq(accounts.id, spaceId));

  await snapshotManager.completeSnapshot(newSnapshot.id);

  return { snapshotId: newSnapshot.id };
}
