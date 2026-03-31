/**
 * Code review logic for the agent workflow system.
 *
 * Handles AI-powered pull request reviews including diff generation,
 * LLM-based analysis, and review persistence.
 */

import type { AgentMessage } from './agent-models.ts';
import type { WorkflowContext, ReviewResult } from './workflow-types.ts';
import { REVIEW_PROMPT } from './workflow-types.ts';
import { LLMClient } from './llm.ts';
import { getDb, pullRequests, prReviews } from '../../../infra/db/index.ts';
import { eq } from 'drizzle-orm';
import { generateId } from '../../../shared/utils/index.ts';
import { buildPRDiffText } from '../pull-requests/ai-review.ts';
import { logError } from '../../../shared/utils/logger.ts';

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

  const llm = new LLMClient({ apiKey });
  const messages: AgentMessage[] = [
    { role: 'system', content: 'You are a code reviewer. Return only valid JSON.' },
    { role: 'user', content: prompt },
  ];

  const response = await llm.chat(messages);

  let reviewResult: ReviewResult;
  try {
    const jsonBody = response.content.trim().startsWith('{')
      ? response.content.trim()
      : response.content.trim().replace(/```json?\n?/g, '').replace(/```/g, '').trim();
    reviewResult = JSON.parse(jsonBody) as ReviewResult;
  } catch (parseError) {
    logError('Failed to parse review JSON', parseError, { module: 'services/agent/workflow-review' });
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
  const timestamp = new Date().toISOString();

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

// ── PR diff helper ──────────────────────────────────────────────────────

export async function getPRDiff(
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
