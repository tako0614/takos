/**
 * artifact-collector.ts
 *
 * CLI-side helper that walks an `AppManifest` looking for workers whose
 * build outputs are referenced via `build.fromWorkflow`, then packs the
 * matching local build artifacts into an upload payload that
 * `takos deploy` (manifest source) sends to the backend.
 *
 * Each compute that opts into local artifact collection produces one
 * record of the shape:
 *
 *   {
 *     compute: "<compute-name>",
 *     workflow: { path, job, artifact, artifactPath },
 *     files: [{ path, encoding: "base64", content }, ...],
 *   }
 *
 * The output is an array (matching the backend zod schema for
 * `source.artifacts: Array<Record<string, unknown>>`). The backend
 * persists the records opaquely on the deployment row; the kernel-side
 * delivery mechanism that consumes them lives in the deploy pipeline.
 *
 * Skipped (intentionally not implemented here):
 *   - .gitignore filtering — if a build directory shouldn't ship a file,
 *     the build pipeline should not emit it.
 *   - Large file chunking — kept simple; files are sent inline.
 *   - Binary content detection — everything is base64 encoded.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import process from "node:process";
import YAML from "yaml";
import type { AppManifest } from "./app-manifest.ts";

export interface CollectedArtifactFile {
  path: string;
  encoding: "base64";
  content: string;
}

export interface CollectedArtifact {
  compute: string;
  workflow: {
    path: string;
    job: string;
    artifact: string;
    artifactPath: string;
  };
  files: CollectedArtifactFile[];
}

export interface CollectArtifactsOptions {
  /**
   * Workspace root used to resolve workflow paths and artifact paths.
   * Defaults to the current working directory.
   */
  workspaceDir?: string;
  /**
   * If true, missing build outputs throw instead of being skipped.
   * Defaults to false (skip + return the error so the caller can warn).
   */
  failOnMissing?: boolean;
}

export interface CollectArtifactsResult {
  artifacts: CollectedArtifact[];
  warnings: string[];
}

/**
 * Walks `manifest.compute` for entries that declare `build.fromWorkflow`
 * and collects their build outputs from disk. Workers whose
 * `artifactPath` is missing are reported in `warnings` so the CLI can
 * surface them to the user without aborting.
 */
export function collectArtifactsForManifest(
  manifest: AppManifest,
  options: CollectArtifactsOptions = {},
): CollectArtifactsResult {
  const workspaceDir = resolve(options.workspaceDir ?? process.cwd());
  const failOnMissing = options.failOnMissing ?? false;
  const artifacts: CollectedArtifact[] = [];
  const warnings: string[] = [];
  const workflowCache = new Map<string, unknown>();

  for (
    const [computeName, compute] of Object.entries(manifest.compute ?? {})
  ) {
    const fromWorkflow = compute.build?.fromWorkflow;
    if (!fromWorkflow) continue;
    if (!fromWorkflow.artifactPath) {
      const message =
        `compute.${computeName}.build.fromWorkflow.artifactPath is required for local artifact collection`;
      if (failOnMissing) throw new Error(message);
      warnings.push(message);
      continue;
    }

    // Verify the workflow file exists and parses. We do not deeply
    // validate jobs/steps here — the backend re-validates with the
    // takos-actions-engine parser. The lookup just confirms the
    // referenced workflow file is reachable from the workspace root.
    const workflowAbsPath = resolve(workspaceDir, fromWorkflow.path);
    if (!workflowCache.has(workflowAbsPath)) {
      if (!existsSync(workflowAbsPath)) {
        const message = `Workflow file not found for compute ${computeName}: ${
          relative(workspaceDir, workflowAbsPath) || workflowAbsPath
        }`;
        if (failOnMissing) throw new Error(message);
        warnings.push(message);
        continue;
      }
      try {
        const parsed = YAML.parse(readFileSync(workflowAbsPath, "utf-8"));
        workflowCache.set(workflowAbsPath, parsed);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const message = `Failed to parse workflow ${
          relative(workspaceDir, workflowAbsPath) || workflowAbsPath
        }: ${detail}`;
        if (failOnMissing) throw new Error(message);
        warnings.push(message);
        continue;
      }
    }

    const workflow = workflowCache.get(workflowAbsPath) as
      | { jobs?: Record<string, unknown> }
      | undefined;
    const jobs = workflow?.jobs;
    if (!jobs || typeof jobs !== "object") {
      const message =
        `Workflow ${fromWorkflow.path} has no jobs (compute ${computeName})`;
      if (failOnMissing) throw new Error(message);
      warnings.push(message);
      continue;
    }
    if (!(fromWorkflow.job in jobs)) {
      const message = `Workflow job not found in ${fromWorkflow.path}: ${fromWorkflow.job} (compute ${computeName})`;
      if (failOnMissing) throw new Error(message);
      warnings.push(message);
      continue;
    }

    const artifactAbsPath = resolve(workspaceDir, fromWorkflow.artifactPath);
    if (!existsSync(artifactAbsPath)) {
      const message = `Build output not found for compute ${computeName}: ${
        relative(workspaceDir, artifactAbsPath) || artifactAbsPath
      } — run your build before deploying`;
      if (failOnMissing) throw new Error(message);
      warnings.push(message);
      continue;
    }

    const files: CollectedArtifactFile[] = [];
    const stats = statSync(artifactAbsPath);
    if (stats.isDirectory()) {
      walkDirectory(artifactAbsPath, artifactAbsPath, files);
    } else if (stats.isFile()) {
      const baseName = artifactAbsPath.split(/[\\/]/).pop() ?? "artifact";
      files.push({
        path: baseName,
        encoding: "base64",
        content: readFileSync(artifactAbsPath).toString("base64"),
      });
    } else {
      const message =
        `Unsupported artifact path for compute ${computeName}: ${artifactAbsPath} (not a regular file or directory)`;
      if (failOnMissing) throw new Error(message);
      warnings.push(message);
      continue;
    }

    if (files.length === 0) {
      const message = `Build output is empty for compute ${computeName}: ${
        relative(workspaceDir, artifactAbsPath) || artifactAbsPath
      }`;
      if (failOnMissing) throw new Error(message);
      warnings.push(message);
      continue;
    }

    artifacts.push({
      compute: computeName,
      workflow: {
        path: fromWorkflow.path,
        job: fromWorkflow.job,
        artifact: fromWorkflow.artifact,
        artifactPath: fromWorkflow.artifactPath,
      },
      files,
    });
  }

  return { artifacts, warnings };
}

/**
 * Resolves the workspace directory for a manifest path.
 * `.takos/app.yml` lives at `<workspace>/.takos/app.yml`, so the
 * workspace is the parent of `.takos/`.
 */
export function resolveWorkspaceDir(manifestPath: string): string {
  const absoluteManifestPath = resolve(manifestPath);
  return dirname(dirname(absoluteManifestPath));
}

function walkDirectory(
  root: string,
  current: string,
  out: CollectedArtifactFile[],
): void {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) {
      walkDirectory(root, fullPath, out);
      continue;
    }
    if (!entry.isFile()) continue;
    const relPath = relative(root, fullPath).split("\\").join("/");
    out.push({
      path: relPath,
      encoding: "base64",
      content: readFileSync(fullPath).toString("base64"),
    });
  }
}
