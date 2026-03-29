import fs from 'node:fs/promises';
import path from 'node:path';
import type { AppManifest } from 'takos-control/source/app-manifest';
import {
  parseAppManifestYaml,
  parseAndValidateWorkflowYaml,
  validateDeployProducerJob,
} from 'takos-control/source/app-manifest';

export type { AppManifest } from 'takos-control/source/app-manifest';

const APP_MANIFEST_FILE_NAMES = [
  path.join('.takos', 'app.yml'),
  path.join('.takos', 'app.yaml'),
];

export async function findAppManifestFile(dir: string): Promise<string | null> {
  for (const relativePath of APP_MANIFEST_FILE_NAMES) {
    const candidate = path.join(dir, relativePath);
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // continue
    }
  }
  return null;
}

export async function loadAppManifest(manifestPath: string): Promise<AppManifest> {
  const absolutePath = path.resolve(manifestPath);
  const raw = await fs.readFile(absolutePath, 'utf8');
  return parseAppManifestYaml(raw);
}

export async function resolveAppManifestPath(startDir = process.cwd()): Promise<string> {
  const manifestPath = await findAppManifestFile(startDir);
  if (!manifestPath) {
    throw new Error('No .takos/app.yml found in the current directory');
  }
  return manifestPath;
}

function normalizeWorkflowPath(workflowPath: string): string {
  return workflowPath
    .replace(/\\/g, '/')
    .replace(/^\.\/+/, '')
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
    .trim();
}

async function validateDeployWorkflowJob(
  repoRoot: string,
  workflowPath: string,
  jobKey: string,
): Promise<void> {
  const normalizedPath = normalizeWorkflowPath(workflowPath);
  if (!normalizedPath) {
    throw new Error('Workflow path is required');
  }
  if (normalizedPath.includes('..')) {
    throw new Error(`Workflow path must not contain path traversal: ${normalizedPath}`);
  }

  const absolutePath = path.resolve(repoRoot, normalizedPath);
  const resolvedRoot = path.resolve(repoRoot);
  if (!absolutePath.startsWith(resolvedRoot + path.sep) && absolutePath !== resolvedRoot) {
    throw new Error(`Workflow path escapes repository root: ${normalizedPath}`);
  }

  const raw = await fs.readFile(absolutePath, 'utf8').catch(() => {
    throw new Error(`Workflow file not found: ${normalizedPath}`);
  });

  const workflow = parseAndValidateWorkflowYaml(raw, normalizedPath);
  validateDeployProducerJob(workflow, normalizedPath, jobKey);
}

export async function validateAppManifest(startDir = process.cwd()) {
  const manifestPath = await resolveAppManifestPath(startDir);
  const manifest = await loadAppManifest(manifestPath);
  const repoRoot = path.dirname(path.dirname(manifestPath));

  for (const [workerName, worker] of Object.entries(manifest.spec.workers)) {
    const build = worker.build.fromWorkflow;
    if (!build.artifactPath) {
      throw new Error(`spec.workers.${workerName}.build.fromWorkflow.artifactPath is required`);
    }
    await validateDeployWorkflowJob(repoRoot, build.path, build.job);
  }

  return {
    manifestPath,
    manifest,
  };
}
