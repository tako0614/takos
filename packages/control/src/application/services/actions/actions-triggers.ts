import type { D1Database, ExecutionContext, Queue, R2Bucket } from '../../../shared/types/bindings.ts';
import { parseWorkflow, type BranchFilter, type PullRequestTriggerConfig, type Workflow, type WorkflowTrigger } from 'takos-actions-engine';
import { getDb, pullRequests, repositories } from '../../../infra/db/index.ts';
import { eq, and } from 'drizzle-orm';
import type { WorkflowJobQueueMessage } from '../../../shared/types/index.ts';
import * as gitStore from '../git-smart/index.ts';
import { createWorkflowEngine } from '../execution/workflow-engine.ts';
import { logError, logWarn } from '../../../shared/utils/logger.ts';

export type PullRequestWorkflowAction = 'opened' | 'edited' | 'closed' | 'synchronize';
export interface PullRequestWorkflowEvent { action: PullRequestWorkflowAction; number: number; title: string; body?: string | null; state: 'open' | 'closed'; merged: boolean; mergedAt?: string | null; headRef: string; headSha?: string | null; baseRef: string; baseSha?: string | null; changedFiles?: string[]; authorId?: string | null; }
export interface TriggerPullRequestWorkflowsOptions { db: D1Database; bucket?: R2Bucket; queue?: Queue<WorkflowJobQueueMessage>; encryptionKey?: string; repoId: string; repoName: string; defaultBranch: string; actorId: string; event: PullRequestWorkflowEvent; }
export interface PullRequestWorkflowTriggerResult { triggeredRunIds: string[]; workflowPaths: string[]; }
export interface TriggerPullRequestSynchronizeOptions { db: D1Database; bucket?: R2Bucket; queue?: Queue<WorkflowJobQueueMessage>; encryptionKey?: string; repoId: string; repoName: string; defaultBranch: string; actorId: string; headBranch: string; headSha?: string; changedFiles?: string[]; }
export interface TriggerPushWorkflowsConfig { db: D1Database; bucket?: R2Bucket; queue?: Queue<WorkflowJobQueueMessage>; encryptionKey?: string; }
export interface TriggerPushWorkflowsEvent { repoId: string; branch: string; before: string | null; after: string; actorId: string; actorName?: string | null; actorEmail?: string | null; }
export interface PushWorkflowTriggerResult { triggeredRunIds: string[]; workflowPaths: string[]; }
interface ResolvedRef { ref: string; sha: string; }
interface WorkflowCandidate { path: string; workflow: Workflow; }

function getTriggerConfig<K extends keyof WorkflowTrigger>(workflow: Workflow, eventName: K): WorkflowTrigger[K] | null | undefined {
  const on = workflow.on;
  if (typeof on === 'string') return on === eventName ? null : undefined;
  if (Array.isArray(on)) return on.includes(eventName) ? null : undefined;
  if (!on || typeof on !== 'object') return undefined;
  if (!(eventName in on)) return undefined;
  const trigger = on[eventName];
  if (!trigger || typeof trigger !== 'object') return null;
  return trigger;
}

async function parseWorkflowFiles(bucket: R2Bucket, commitSha: string): Promise<WorkflowCandidate[]> {
  const commit = await gitStore.getCommitData(bucket, commitSha);
  if (!commit) return [];
  const entries = await gitStore.listDirectory(bucket, commit.tree, '.takos/workflows');
  if (!entries) return [];
  const candidates: WorkflowCandidate[] = [];
  for (const entry of entries) {
    if (entry.mode === gitStore.FILE_MODES.DIRECTORY) continue;
    const lowerName = entry.name.toLowerCase();
    if (!lowerName.endsWith('.yml') && !lowerName.endsWith('.yaml')) continue;
    const path = `.takos/workflows/${entry.name}`;
    const blob = await gitStore.getBlobAtPath(bucket, commit.tree, path);
    if (!blob) continue;
    const content = new TextDecoder().decode(blob);
    const { workflow, diagnostics } = parseWorkflow(content);
    if (diagnostics.some((d) => d.severity === 'error')) continue;
    candidates.push({ path, workflow });
  }
  return candidates;
}

function matchesBranchAndPathFilters(config: BranchFilter, branch: string, changedFiles?: string[]): boolean {
  if (!matchesBranchFilters(branch, config.branches, config['branches-ignore'])) return false;
  if (!matchesPathFilters(changedFiles, config.paths, config['paths-ignore'])) return false;
  return true;
}

export async function triggerPullRequestWorkflows(options: TriggerPullRequestWorkflowsOptions): Promise<PullRequestWorkflowTriggerResult> {
  const result: PullRequestWorkflowTriggerResult = { triggeredRunIds: [], workflowPaths: [] };
  if (!options.bucket) { logWarn('GIT_OBJECTS not configured, skipping pull_request workflow triggers', { module: 'services/actions/actions-triggers' }); return result; }
  if (!options.queue) { logWarn('WORKFLOW_QUEUE not configured, skipping pull_request workflow triggers', { module: 'services/actions/actions-triggers' }); return result; }
  const resolvedRef = await resolveRefForPullRequestEvent(options.db, options.repoId, options.defaultBranch, options.event);
  if (!resolvedRef) { logWarn('No ref could be resolved for pull_request workflow trigger', { module: 'services/actions/actions-triggers', ...{ repoId: options.repoId, action: options.event.action, number: options.event.number } }); return result; }
  const allWorkflows = await parseWorkflowFiles(options.bucket, resolvedRef.sha);
  const candidates = allWorkflows.filter((c) => matchesPullRequestTrigger(c.workflow, options.event));
  if (candidates.length === 0) return result;
  const engine = createWorkflowEngine({ db: options.db, bucket: options.bucket, queue: options.queue });
  const inputs = buildPullRequestRunInputs(options.repoId, options.repoName, options.defaultBranch, options.event);
  for (const candidate of candidates) {
    try {
      const run = await engine.startRun({ repoId: options.repoId, workflowPath: candidate.path, event: 'pull_request', ref: resolvedRef.ref, sha: resolvedRef.sha, actorId: options.actorId, inputs });
      result.triggeredRunIds.push(run.id); result.workflowPaths.push(candidate.path);
    } catch (err) { logError(`Failed to start pull_request workflow ${candidate.path}`, err, { module: 'services/actions/actions-triggers' }); }
  }
  return result;
}

export async function triggerPullRequestSynchronizeForHeadUpdate(options: TriggerPullRequestSynchronizeOptions): Promise<PullRequestWorkflowTriggerResult[]> {
  const db = getDb(options.db);
  const prs = await db.select({ number: pullRequests.number, title: pullRequests.title, description: pullRequests.description, headBranch: pullRequests.headBranch, baseBranch: pullRequests.baseBranch, authorId: pullRequests.authorId })
    .from(pullRequests).where(and(eq(pullRequests.repoId, options.repoId), eq(pullRequests.headBranch, options.headBranch), eq(pullRequests.status, 'open'))).all();
  const results: PullRequestWorkflowTriggerResult[] = [];
  for (const pr of prs) {
    let baseSha: string | null = null;
    try { baseSha = await gitStore.resolveRef(options.db, options.repoId, pr.baseBranch); } catch (err) { logError(`Failed to resolve base ref for PR #${pr.number}`, err, { module: 'services/actions/actions-triggers' }); }
    const triggerResult = await triggerPullRequestWorkflows({
      db: options.db, bucket: options.bucket, queue: options.queue, encryptionKey: options.encryptionKey,
      repoId: options.repoId, repoName: options.repoName, defaultBranch: options.defaultBranch, actorId: options.actorId,
      event: { action: 'synchronize', number: pr.number, title: pr.title, body: pr.description, state: 'open', merged: false, headRef: pr.headBranch, headSha: options.headSha, baseRef: pr.baseBranch, baseSha: baseSha ?? undefined, changedFiles: options.changedFiles, authorId: pr.authorId },
    });
    results.push(triggerResult);
  }
  return results;
}

async function resolveRefForPullRequestEvent(d1: D1Database, repoId: string, defaultBranch: string, event: PullRequestWorkflowEvent): Promise<ResolvedRef | null> {
  const candidateRefs = uniqueRefs([event.baseRef, defaultBranch]);
  for (const ref of candidateRefs) {
    const resolvedSha = await gitStore.resolveRef(d1, repoId, ref);
    if (!resolvedSha) continue;
    if (ref === event.baseRef && event.baseSha) return { ref, sha: event.baseSha };
    return { ref, sha: resolvedSha };
  }
  return null;
}

function matchesPullRequestTrigger(workflow: Workflow, event: PullRequestWorkflowEvent): boolean {
  const triggerConfig = getTriggerConfig(workflow, 'pull_request');
  if (triggerConfig === undefined) return false;
  if (triggerConfig === null) return true;
  const config = triggerConfig as PullRequestTriggerConfig;
  if (Array.isArray(config.types) && config.types.length > 0 && !config.types.includes(event.action)) return false;
  return matchesBranchAndPathFilters(config, event.baseRef, event.changedFiles);
}

function buildPullRequestRunInputs(repoId: string, repoName: string, defaultBranch: string, event: PullRequestWorkflowEvent): Record<string, unknown> {
  return {
    action: event.action, number: event.number, title: event.title, body: event.body || '', state: event.state, merged: event.merged, merged_at: event.mergedAt || null,
    head_ref: event.headRef, head_sha: event.headSha || null, base_ref: event.baseRef, base_sha: event.baseSha || null, changed_files: event.changedFiles || [],
    pull_request: { number: event.number, title: event.title, body: event.body || '', state: event.state, merged: event.merged, merged_at: event.mergedAt || null, head: { ref: event.headRef, sha: event.headSha || null }, base: { ref: event.baseRef, sha: event.baseSha || null }, user: { id: event.authorId || null } },
    repository: { id: repoId, name: repoName, full_name: `${repoId}/${repoName}`, default_branch: defaultBranch },
  };
}

function normalizePushBranchRef(ref: string): string { return ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref; }

async function computePushChangedFiles(bucket: R2Bucket, afterSha: string, beforeSha: string | null): Promise<string[]> {
  const afterCommit = await gitStore.getCommitData(bucket, afterSha);
  if (!afterCommit) return [];
  const afterFiles = await gitStore.flattenTree(bucket, afterCommit.tree);
  if (!beforeSha) return afterFiles.map((file) => file.path).sort((a, b) => a.localeCompare(b));
  const beforeCommit = await gitStore.getCommitData(bucket, beforeSha);
  if (!beforeCommit) return afterFiles.map((file) => file.path).sort((a, b) => a.localeCompare(b));
  const beforeFiles = await gitStore.flattenTree(bucket, beforeCommit.tree);
  const beforeMap = new Map(beforeFiles.map((file) => [file.path, file.sha]));
  const afterMap = new Map(afterFiles.map((file) => [file.path, file.sha]));
  const changed = new Set<string>();
  for (const [path, oid] of afterMap) { if (!beforeMap.has(path) || beforeMap.get(path) !== oid) changed.add(path); }
  for (const path of beforeMap.keys()) { if (!afterMap.has(path)) changed.add(path); }
  return Array.from(changed).sort((a, b) => a.localeCompare(b));
}

function matchesPushTrigger(workflow: Workflow, branch: string, changedFiles: string[]): boolean {
  const triggerConfig = getTriggerConfig(workflow, 'push');
  if (triggerConfig === undefined) return false;
  if (triggerConfig === null) return true;
  const config = triggerConfig as BranchFilter;
  if ((!Array.isArray(config.branches) || config.branches.length === 0) && Array.isArray(config.tags) && config.tags.length > 0) return false;
  return matchesBranchAndPathFilters(config, branch, changedFiles);
}

// ---------------------------------------------------------------------------
// Scheduled (cron) workflow trigger — DEFERRED
// ---------------------------------------------------------------------------
//
// GitHub Actions YAML `on: schedule: - cron: '...'` is accepted by
// `takos-actions-engine`'s parser (see `packages/actions-engine/src/parser/workflow.ts`
// `normalizeSchedule()`) but there is currently NO kernel-side scan loop that
// walks the `workflows` table, evaluates cron expressions against the current
// tick, and calls `dispatchWorkflowRun()`. Scheduled workflows therefore
// silently never fire.
//
// Round 11 (Workflow #5): a full implementation requires (a) a dependency-free
// cron parser that covers the `*/N`, `M H * * *`, and `0 * * * *` forms at
// minimum, (b) a `last_scheduled_at` column on the `workflows` table (or a
// dedicated `scheduled_workflow_runs` tracking table) to avoid double-firing
// when cron resolution > tick interval, (c) hourly cron hook wiring in
// `packages/control/src/web.ts` that invokes a new `triggerScheduledWorkflows()`
// helper defined here. This was intentionally deferred from Round 11 because
// the three sub-tasks collectively exceed the round's budget and none of them
// can be safely stubbed in isolation.
//
// See `docs/reference/api.md#trigger-compatibility` for the user-visible
// documentation of this gap.
// TODO(round-12, workflow#5): implement `triggerScheduledWorkflows()` plus
// hourly cron wiring in `web.ts`.
export async function triggerPushWorkflows(config: TriggerPushWorkflowsConfig, event: TriggerPushWorkflowsEvent): Promise<PushWorkflowTriggerResult> {
  const result: PushWorkflowTriggerResult = { triggeredRunIds: [], workflowPaths: [] };
  if (!config.bucket || !config.queue) return result;
  const branch = normalizePushBranchRef(event.branch);
  const resolvedAfterSha = await gitStore.resolveRef(config.db, event.repoId, branch) || event.after;
  const changedFiles = await computePushChangedFiles(config.bucket, resolvedAfterSha, event.before);
  const allWorkflows = await parseWorkflowFiles(config.bucket, resolvedAfterSha);
  const candidates = allWorkflows.filter((c) => matchesPushTrigger(c.workflow, branch, changedFiles));
  if (candidates.length === 0) { await triggerPullRequestSynchronizeFromPush({ config, event, branch, afterSha: resolvedAfterSha, changedFiles }); return result; }
  const engine = createWorkflowEngine({ db: config.db, bucket: config.bucket, queue: config.queue });
  const pushInputs: Record<string, unknown> = {
    event_name: 'push', ref: `refs/heads/${branch}`, branch, before: event.before, after: resolvedAfterSha, created: event.before === null, deleted: false, forced: false,
    repository: { id: event.repoId }, pusher: { id: event.actorId, name: event.actorName || null, email: event.actorEmail || null }, sender: { id: event.actorId, name: event.actorName || null, email: event.actorEmail || null },
  };
  for (const candidate of candidates) {
    try {
      const run = await engine.startRun({ repoId: event.repoId, workflowPath: candidate.path, event: 'push', ref: branch, sha: resolvedAfterSha, actorId: event.actorId, inputs: pushInputs });
      result.triggeredRunIds.push(run.id); result.workflowPaths.push(candidate.path);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('Workflow does not support event: push')) continue;
      logError(`Failed to start push workflow ${candidate.path}`, err, { module: 'services/actions/actions-triggers' });
    }
  }
  await triggerPullRequestSynchronizeFromPush({ config, event, branch, afterSha: resolvedAfterSha, changedFiles });
  return result;
}

async function triggerPullRequestSynchronizeFromPush(options: { config: TriggerPushWorkflowsConfig; event: TriggerPushWorkflowsEvent; branch: string; afterSha: string; changedFiles: string[]; }): Promise<void> {
  const { config, event, branch, afterSha, changedFiles } = options;
  const db = getDb(config.db);
  const repo = await db.select({ name: repositories.name, defaultBranch: repositories.defaultBranch }).from(repositories).where(eq(repositories.id, event.repoId)).get();
  if (!repo) return;
  try {
    await triggerPullRequestSynchronizeForHeadUpdate({ db: config.db, bucket: config.bucket, queue: config.queue, encryptionKey: config.encryptionKey, repoId: event.repoId, repoName: repo.name, defaultBranch: repo.defaultBranch || 'main', actorId: event.actorId, headBranch: branch, headSha: afterSha, changedFiles });
  } catch (err) { logError(`Failed to trigger pull_request synchronize workflows for ${event.repoId}/${branch}`, err, { module: 'services/actions/actions-triggers' }); }
}

function matchesBranchFilters(branch: string, branches?: string[], branchesIgnore?: string[]): boolean {
  if (Array.isArray(branches) && branches.length > 0 && !matchesAnyPattern(branch, branches)) return false;
  if (Array.isArray(branchesIgnore) && branchesIgnore.length > 0 && matchesAnyPattern(branch, branchesIgnore)) return false;
  return true;
}

function matchesPathFilters(changedFiles: string[] | undefined, paths?: string[], pathsIgnore?: string[]): boolean {
  if (!changedFiles || changedFiles.length === 0) { return !(Array.isArray(paths) && paths.length > 0) && !(Array.isArray(pathsIgnore) && pathsIgnore.length > 0); }
  if (Array.isArray(paths) && paths.length > 0 && !changedFiles.some((file) => matchesAnyPattern(file, paths))) return false;
  if (Array.isArray(pathsIgnore) && pathsIgnore.length > 0 && changedFiles.every((file) => matchesAnyPattern(file, pathsIgnore))) return false;
  return true;
}

function matchesAnyPattern(value: string, patterns: string[]): boolean { return patterns.some((pattern) => globToRegExp(pattern).test(value)); }

const globCache = new Map<string, RegExp>();
function globToRegExp(glob: string): RegExp {
  const cached = globCache.get(glob);
  if (cached) return cached;
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '___DOUBLE_STAR___').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]').replace(/___DOUBLE_STAR___/g, '.*');
  const regex = new RegExp(`^${escaped}$`);
  globCache.set(glob, regex);
  return regex;
}

function uniqueRefs(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value))));
}

export function scheduleActionsAutoTrigger(executionCtx: Pick<ExecutionContext, 'waitUntil'> | undefined, taskFactory: () => Promise<unknown>, source: string): void {
  const wrapped = taskFactory().catch((error) => { logError(`${source}: unexpected workflow trigger failure`, error, { module: 'actions-triggers' }); });
  if (executionCtx && typeof executionCtx.waitUntil === 'function') { executionCtx.waitUntil(wrapped); return; }
  void wrapped;
}
