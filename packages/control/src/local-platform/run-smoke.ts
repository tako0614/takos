import { createTakosWebEnv, disposeLocalPlatformState } from './adapters/local.ts';
import { getDb, accounts, accountMemberships, threads, messages, runs } from '../infra/db/index.ts';
import { RUN_QUEUE_MESSAGE_VERSION } from '../shared/types/queue-messages.ts';
import { createPendingRun, updateRunStatus } from '../application/services/runs/create-thread-run-store.ts';
import { eq } from 'drizzle-orm';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const POLL_INTERVAL_MS = 1_000;
const POLL_TIMEOUT_MS = 45_000;

function nowIso(): string {
  return new Date().toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureSeedData() {
  const env = await createTakosWebEnv();
  const db = getDb(env.DB);
  const suffix = Date.now().toString(36);
  const workspaceId = `smoke-workspace-${suffix}`;
  const userId = `smoke-user-${suffix}`;
  const threadId = `smoke-thread-${suffix}`;
  const runId = `smoke-run-${suffix}`;
  const createdAt = nowIso();

  await db.insert(accounts).values({
    id: workspaceId,
    type: 'workspace',
    status: 'active',
    name: 'Local Smoke Workspace',
    slug: `local-smoke-workspace-${suffix}`,
  }).run();

  await db.insert(accounts).values({
    id: userId,
    type: 'user',
    status: 'active',
    name: 'Local Smoke User',
    slug: `local-smoke-user-${suffix}`,
    email: `local-smoke-${suffix}@example.com`,
  }).run();

  await db.insert(accountMemberships).values({
    id: `smoke-membership-${suffix}`,
    accountId: workspaceId,
    memberId: userId,
    role: 'owner',
    status: 'active',
  }).run();

  await db.insert(threads).values({
    id: threadId,
    accountId: workspaceId,
    title: 'Local Smoke Thread',
    status: 'active',
    createdAt,
    updatedAt: createdAt,
  }).run();

  await db.insert(messages).values({
    id: `smoke-message-${suffix}`,
    threadId,
    role: 'user',
    content: 'hello from local smoke run',
    metadata: '{}',
    sequence: 1,
    createdAt,
  }).run();

  await createPendingRun(env.DB, {
    runId,
    threadId,
    spaceId: workspaceId,
    requesterAccountId: userId,
    parentRunId: null,
    childThreadId: null,
    rootThreadId: threadId,
    rootRunId: runId,
    agentType: 'default',
    input: JSON.stringify({ smoke: true }),
    createdAt,
  });

  await env.RUN_QUEUE.send({
    version: RUN_QUEUE_MESSAGE_VERSION,
    runId,
    timestamp: Date.now(),
    model: 'local-smoke',
  });

  await updateRunStatus(env.DB, {
    runId,
    status: 'queued',
    error: null,
  });

  return { env, db, runId, threadId, workspaceId, userId };
}

async function waitForRunCompletion(runId: string) {
  const env = await createTakosWebEnv();
  const db = getDb(env.DB);
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const run = await db.select({
      id: runs.id,
      status: runs.status,
      error: runs.error,
      output: runs.output,
      workerId: runs.workerId,
      startedAt: runs.startedAt,
      completedAt: runs.completedAt,
    }).from(runs).where(eq(runs.id, runId)).get();

    if (!run) {
      throw new Error(`Smoke run not found: ${runId}`);
    }

    if (run.status === 'completed') {
      return run;
    }

    if (run.status === 'failed' || run.status === 'cancelled') {
      throw new Error(`Smoke run ended in ${run.status}: ${run.error ?? 'unknown error'}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }

  throw new Error(`Smoke run timed out after ${POLL_TIMEOUT_MS}ms`);
}

export async function runLocalSmoke() {
  const seeded = await ensureSeedData();
  const result = await waitForRunCompletion(seeded.runId);

  return {
    runId: result.id,
    status: result.status,
    workerId: result.workerId,
    startedAt: result.startedAt,
    completedAt: result.completedAt,
    output: result.output,
  };
}

async function main() {
  try {
    const payload = await runLocalSmoke();
    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await disposeLocalPlatformState();
  }
}

function isDirectEntrypoint(): boolean {
  const entrypoint = process.argv[2];
  if (!entrypoint) return false;
  return import.meta.url === pathToFileURL(path.resolve(process.cwd(), entrypoint)).href;
}

if (isDirectEntrypoint()) {
  main().catch((error) => {
    if (error instanceof Error) {
      console.error(error.stack ?? error.message);
    } else {
      console.error(String(error));
    }
    process.exit(1);
  });
}
