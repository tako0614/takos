/**
 * Pull request helpers for the agent workflow system.
 *
 * Handles PR creation and merge operations against the D1 database.
 */

import type { WorkflowContext } from "./workflow-types.ts";
import {
  accounts,
  branches,
  getDb,
  pullRequests,
  runs,
  sessions,
} from "../../../infra/db/index.ts";
import { and, eq, sql } from "drizzle-orm";
import { generateId } from "../../../shared/utils/index.ts";

// ── PR creation ─────────────────────────────────────────────────────────

export async function createPullRequest(
  context: WorkflowContext,
  options: {
    repoId: string;
    title: string;
    description: string;
    headBranch: string;
    baseBranch: string;
  },
): Promise<string> {
  const { env, userId, runId } = context;
  const db = getDb(env.DB);
  const timestamp = new Date().toISOString();
  const prId = generateId();

  const MAX_RETRIES = 5;
  const baseDelayMs = 10;
  const maxDelayMs = 500;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const maxResult = await db.select({
        maxNumber: sql<number>`max(${pullRequests.number})`,
      }).from(pullRequests).where(eq(pullRequests.repoId, options.repoId))
        .get();

      const nextNumber = (maxResult?.maxNumber ?? 0) + 1;

      await db.insert(pullRequests).values({
        id: prId,
        repoId: options.repoId,
        number: nextNumber,
        title: options.title,
        description: options.description,
        headBranch: options.headBranch,
        baseBranch: options.baseBranch,
        status: "open",
        authorType: "agent",
        authorId: userId,
        runId,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      return prId;
    } catch (error) {
      const errorMessage = error instanceof Error
        ? error.message
        : String(error);
      const isRetryable = errorMessage.includes("UNIQUE constraint") ||
        errorMessage.includes("SQLITE_BUSY");

      if (isRetryable && attempt < MAX_RETRIES - 1) {
        const exponentialDelay = Math.min(
          maxDelayMs,
          baseDelayMs * Math.pow(2, attempt),
        );
        const jitter = Math.random() * exponentialDelay;
        const totalDelay = Math.floor(exponentialDelay + jitter);
        await new Promise((resolve) => setTimeout(resolve, totalDelay));
        continue;
      }
      throw error;
    }
  }

  throw new Error(
    `Failed to create PR after ${MAX_RETRIES} attempts due to number conflicts`,
  );
}

// ── PR merge ────────────────────────────────────────────────────────────

export async function mergePullRequest(
  context: WorkflowContext,
  prId: string,
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

  if (pullRequest.status === "merged") {
    return;
  }

  const timestamp = new Date().toISOString();

  // Resolve sessionId from the associated run
  let sessionId: string | null = null;
  if (pullRequest.runId) {
    const runRow = await db.select({ sessionId: runs.sessionId }).from(runs)
      .where(eq(runs.id, pullRequest.runId)).get();
    sessionId = runRow?.sessionId ?? null;
  }

  await db.update(pullRequests).set({
    status: "merged",
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
        status: "merged",
        branch: null,
        updatedAt: timestamp,
      }).where(eq(sessions.id, session.id));

      if (pullRequest.headBranch !== pullRequest.baseBranch) {
        await db.delete(branches).where(
          and(
            eq(branches.repoId, pullRequest.repoId),
            eq(branches.name, pullRequest.headBranch),
            eq(branches.isDefault, false),
          ),
        );
      }
    }
  }
}
