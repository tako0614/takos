import { getDb } from '../../../infra/db';
import { workflowRuns, workflowJobs } from '../../../infra/db/schema';
import { eq, and, desc } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { checkRepoAccess } from '../source/repos';
import * as gitStore from '../git-smart';
import { resolveWorkflowArtifactFileForJob } from './workflow-artifacts';
import {
  appManifestToBundleDocs,
  buildParsedPackageFromDocs,
  extractBuildSourcesFromManifestJson,
  parseAndValidateWorkflowYaml,
  parseAppManifestYaml,
  selectAppManifestPathFromRepo,
  validateDeployProducerJob,
  type AppDeploymentBuildSource,
  type AppManifest,
} from '../source/app-manifest';

type RepoRefType = 'branch' | 'tag' | 'commit';

type CreateAppDeploymentInput = {
  repoId: string;
  ref?: string;
  refType?: RepoRefType;
  approveOauthAutoEnv?: boolean;
  approveSourceChange?: boolean;
};

type ResolvedRepoTarget = {
  repoId: string;
  ref: string;
  refType: RepoRefType;
  commitSha: string;
  treeSha: string;
};

type ResolvedBuildArtifacts = {
  buildSources: AppDeploymentBuildSource[];
  packageFiles: Map<string, ArrayBuffer | Uint8Array>;
};

export function encodeSourceRef(refType: RepoRefType | undefined, ref: string | undefined, commitSha?: string): string | undefined {
  const normalizedRef = String(ref || '').trim();
  if (!normalizedRef) return undefined;
  const base = `${refType || 'branch'}:${normalizedRef}`;
  return commitSha ? `${base}@${commitSha}` : base;
}

export function decodeSourceRef(encoded: string | null | undefined): {
  ref: string | null;
  ref_type: RepoRefType | null;
  commit_sha: string | null;
} {
  const raw = String(encoded || '').trim();
  if (!raw) return { ref: null, ref_type: null, commit_sha: null };
  const separator = raw.indexOf(':');
  if (separator <= 0) return { ref: raw, ref_type: null, commit_sha: null };
  const rawType = raw.slice(0, separator).trim();
  const rest = raw.slice(separator + 1).trim();
  const atIndex = rest.indexOf('@');
  const ref = atIndex > 0 ? rest.slice(0, atIndex) : rest;
  const commitSha = atIndex > 0 ? rest.slice(atIndex + 1) : null;
  return {
    ref: ref || null,
    ref_type: rawType === 'branch' || rawType === 'tag' || rawType === 'commit' ? rawType : null,
    commit_sha: commitSha || null,
  };
}

function normalizeRepoPath(value: string): string {
  return String(value || '')
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .trim();
}

function getGitBucket(env: Env) {
  return env.GIT_OBJECTS || null;
}


function buildWorkflowRunRef(refType: RepoRefType, ref: string): string | null {
  if (refType === 'branch') return `refs/heads/${ref}`;
  if (refType === 'tag') return `refs/tags/${ref}`;
  return null;
}

function normalizeRepoRef(refType: RepoRefType, ref: string): string {
  const normalized = String(ref || '').trim();
  if (!normalized) {
    throw new Error('ref is required');
  }
  if (refType === 'branch') {
    return normalized.replace(/^refs\/heads\//, '');
  }
  if (refType === 'tag') {
    return normalized.replace(/^refs\/tags\//, '');
  }
  return normalized;
}

function isDirectoryMode(mode: string | undefined): boolean {
  return mode === '040000' || mode === '40000';
}

function looksLikeInlineSql(value: string): boolean {
  const sql = value.trim();
  if (!sql) return false;
  if (/\n/.test(sql) && /;/.test(sql)) return true;
  return /^(--|\/\*|\s*(create|alter|drop|insert|update|delete|pragma|begin|commit|with)\b)/i.test(sql);
}

async function readRepoTextFileAtCommit(
  env: Env,
  treeSha: string,
  filePath: string,
): Promise<string | null> {
  const bucket = getGitBucket(env);
  if (!bucket) throw new Error('Git storage is not configured');
  const blob = await gitStore.getBlobAtPath(bucket, treeSha, normalizeRepoPath(filePath));
  if (!blob) return null;
  return new TextDecoder().decode(blob);
}

function toArrayBuffer(value: ArrayBuffer | SharedArrayBuffer | ArrayBufferView): ArrayBuffer {
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (value instanceof SharedArrayBuffer) {
    const copy = new Uint8Array(value.byteLength);
    copy.set(new Uint8Array(value));
    return copy.buffer;
  }
  const copy = new Uint8Array(value.byteLength);
  copy.set(new Uint8Array(value.buffer, value.byteOffset, value.byteLength));
  return copy.buffer;
}

async function readRepoManifestAtCommit(env: Env, treeSha: string): Promise<{ path: string; raw: string }> {
  const entries = ['.takos/app.yml', '.takos/app.yaml'] as const;
  const found: string[] = [];
  for (const entry of entries) {
    const content = await readRepoTextFileAtCommit(env, treeSha, entry);
    if (content != null) {
      found.push(entry);
      if (found.length === 1) {
        return { path: entry, raw: content };
      }
    }
  }
  const selected = selectAppManifestPathFromRepo(found);
  if (!selected) {
    throw new Error('No .takos/app.yml found at the requested repo ref');
  }
  throw new Error(`Failed to read manifest: ${selected}`);
}

async function addRepoSqlPathToPackage(
  env: Env,
  treeSha: string,
  configuredPath: string,
  packageFiles: Map<string, ArrayBuffer | Uint8Array>,
): Promise<void> {
  const bucket = getGitBucket(env);
  if (!bucket) throw new Error('Git storage is not configured');

  const normalizedPath = normalizeRepoPath(configuredPath);
  if (!normalizedPath) {
    throw new Error('Migration path is empty');
  }

  const entry = await gitStore.getEntryAtPath(bucket, treeSha, normalizedPath);
  if (!entry) {
    throw new Error(`Migration path not found in repo: ${normalizedPath}`);
  }

  if (isDirectoryMode(entry.mode)) {
    const files = await gitStore.flattenTree(bucket, entry.sha, normalizedPath, { skipSymlinks: true });
    const sqlFiles = files.filter((file) => file.path.toLowerCase().endsWith('.sql'));
    if (sqlFiles.length === 0) {
      throw new Error(`Migration directory contains no .sql files: ${normalizedPath}`);
    }
    for (const file of sqlFiles) {
      const blob = await gitStore.getBlob(bucket, file.sha);
      if (!blob) {
        throw new Error(`Migration file not found in git object storage: ${file.path}`);
      }
      packageFiles.set(file.path, toArrayBuffer(blob));
    }
    return;
  }

  if (!normalizedPath.toLowerCase().endsWith('.sql')) {
    throw new Error(`Migration file must end with .sql: ${normalizedPath}`);
  }
  const blob = await gitStore.getBlob(bucket, entry.sha);
  if (!blob) {
    throw new Error(`Migration file not found in git object storage: ${normalizedPath}`);
  }
  packageFiles.set(normalizedPath, toArrayBuffer(blob));
}

export class AppDeploymentService {
  constructor(private env: Env) {}

  private async resolveRepoTarget(spaceId: string, userId: string, input: CreateAppDeploymentInput): Promise<ResolvedRepoTarget> {
    const repoId = String(input.repoId || '').trim();
    if (!repoId) throw new Error('repo_id is required');

    const repoAccess = await checkRepoAccess(this.env, repoId, userId, ['owner', 'admin', 'editor']);
    if (!repoAccess || repoAccess.spaceId !== spaceId) {
      throw new Error('Repository not found or not accessible from this space');
    }

    const refType = input.refType || 'branch';
    const ref = normalizeRepoRef(
      refType,
      String(input.ref || '').trim() || (refType === 'branch' ? repoAccess.repo.default_branch || 'main' : ''),
    );
    if (!ref) {
      throw new Error('ref is required for tag/commit deployments');
    }

    const bucket = getGitBucket(this.env);
    if (!bucket) throw new Error('Git storage is not configured');

    const commitSha = refType === 'commit'
      ? ref
      : await gitStore.resolveRef(this.env.DB, repoId, ref);
    if (!commitSha) {
      throw new Error(`Ref not found: ${ref}`);
    }
    const commit = await gitStore.getCommitData(bucket, commitSha);
    if (!commit) {
      throw new Error(`Commit not found: ${commitSha}`);
    }

    return {
      repoId,
      ref,
      refType,
      commitSha,
      treeSha: commit.tree,
    };
  }

  private async resolveBuildArtifacts(
    target: ResolvedRepoTarget,
    manifest: AppManifest,
  ): Promise<ResolvedBuildArtifacts> {
    const bucket = getGitBucket(this.env);
    if (!bucket) throw new Error('Git storage is not configured');
    const db = getDb(this.env.DB);
    const workflowCache = new Map<string, ReturnType<typeof parseAndValidateWorkflowYaml>>();
    const packageFiles = new Map<string, ArrayBuffer | Uint8Array>();
    const buildSources: AppDeploymentBuildSource[] = [];

    for (const [workerName, worker] of Object.entries(manifest.spec.workers || {})) {
      const build = worker.build.fromWorkflow;
      const workflowContent = await readRepoTextFileAtCommit(this.env, target.treeSha, build.path);
      if (!workflowContent) {
        throw new Error(`Workflow file not found at repo ref: ${build.path}`);
      }

      let workflow = workflowCache.get(build.path);
      if (!workflow) {
        workflow = parseAndValidateWorkflowYaml(workflowContent, build.path);
        workflowCache.set(build.path, workflow);
      }
      validateDeployProducerJob(workflow, build.path, build.job);

      const workflowRunRef = buildWorkflowRunRef(target.refType, target.ref);

      // Build where conditions for workflow run query
      const baseConditions = and(
        eq(workflowRuns.repoId, target.repoId),
        eq(workflowRuns.workflowPath, build.path),
        eq(workflowRuns.status, 'completed'),
        eq(workflowRuns.conclusion, 'success'),
        ...(workflowRunRef ? [eq(workflowRuns.ref, workflowRunRef)] : [eq(workflowRuns.sha, target.commitSha)]),
      );

      // Find matching workflow runs
      const matchingRuns = await db.select({
        id: workflowRuns.id,
        sha: workflowRuns.sha,
        completedAt: workflowRuns.completedAt,
        createdAt: workflowRuns.createdAt,
      }).from(workflowRuns).where(baseConditions).orderBy(
        desc(workflowRuns.completedAt),
        desc(workflowRuns.createdAt),
      ).all();

      // Find a run with a successful matching job
      let foundRun: { id: string; sha: string | null; jobId: string } | null = null;
      for (const run of matchingRuns) {
        const matchingJob = await db.select({ id: workflowJobs.id }).from(workflowJobs).where(
          and(
            eq(workflowJobs.runId, run.id),
            eq(workflowJobs.jobKey, build.job),
            eq(workflowJobs.status, 'completed'),
            eq(workflowJobs.conclusion, 'success'),
          )
        ).orderBy(
          desc(workflowJobs.completedAt),
          desc(workflowJobs.createdAt),
        ).get();

        if (matchingJob) {
          foundRun = { id: run.id, sha: run.sha, jobId: matchingJob.id };
          break;
        }
      }

      if (!foundRun) {
        throw new Error(`Latest successful workflow run not found for ${build.path}#${build.job} on ${target.refType}:${target.ref}`);
      }

      const jobId = String(foundRun.jobId || '').trim();
      if (!jobId) {
        throw new Error(`Successful workflow job record not found for ${build.path}#${build.job} on run ${foundRun.id}`);
      }

      const artifactPath = normalizeRepoPath(build.artifactPath);
      const resolvedArtifact = await resolveWorkflowArtifactFileForJob(this.env, {
        repoId: target.repoId,
        runId: foundRun.id,
        jobId,
        artifactName: build.artifact,
        artifactPath,
      });
      const artifactObject = await bucket.get(resolvedArtifact.r2Key)
        || await this.env.TENANT_SOURCE?.get(resolvedArtifact.r2Key)
        || null;
      if (!artifactObject) {
        throw new Error(`Workflow artifact file disappeared during app deploy: ${resolvedArtifact.r2Key}`);
      }

      packageFiles.set(artifactPath, new Uint8Array(await artifactObject.arrayBuffer()));
      buildSources.push({
        service_name: workerName,
        workflow_path: build.path,
        workflow_job: build.job,
        workflow_artifact: build.artifact,
        artifact_path: artifactPath,
        workflow_run_id: foundRun.id,
        workflow_job_id: jobId,
        ...(foundRun.sha ? { source_sha: foundRun.sha } : {}),
      });
    }

    for (const resource of Object.values(manifest.spec.resources || {})) {
      if (!resource.migrations) continue;
      if (typeof resource.migrations === 'string') {
        if (!looksLikeInlineSql(resource.migrations)) {
          await addRepoSqlPathToPackage(this.env, target.treeSha, resource.migrations, packageFiles);
        }
        continue;
      }

      await addRepoSqlPathToPackage(this.env, target.treeSha, resource.migrations.up, packageFiles);
      await addRepoSqlPathToPackage(this.env, target.treeSha, resource.migrations.down, packageFiles);
    }

    return {
      buildSources,
      packageFiles,
    };
  }

  async deployFromRepoRef(_spaceId: string, _userId: string, _input: CreateAppDeploymentInput): Promise<never> {
    throw new Error('Legacy bundle deployment pipeline has been removed. Use the app deployment API instead.');
  }

  async list(_spaceId: string): Promise<never> {
    throw new Error('Legacy bundle deployment pipeline has been removed. Use the app deployment API instead.');
  }

  async get(_spaceId: string, _appDeploymentId: string): Promise<never> {
    throw new Error('Legacy bundle deployment pipeline has been removed. Use the app deployment API instead.');
  }

  async remove(_spaceId: string, _appDeploymentId: string): Promise<never> {
    throw new Error('Legacy bundle deployment pipeline has been removed. Use the app deployment API instead.');
  }

  async rollback(_spaceId: string, _userId: string, _appDeploymentId: string, _options?: {
    approveOauthAutoEnv?: boolean;
  }): Promise<never> {
    throw new Error('Legacy bundle deployment pipeline has been removed. Use the app deployment API instead.');
  }
}

export function createAppDeploymentService(env: Env) {
  return new AppDeploymentService(env);
}
