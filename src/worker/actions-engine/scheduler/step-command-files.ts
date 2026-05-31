import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter as pathDelimiter, join } from "node:path";

import { MAX_COMMAND_FILE_BYTES } from "../constants.ts";
import { parseGitHubEnvFile } from "../context.ts";
import { parsePathFile } from "./step-output-parser.ts";

export interface StepCommandFiles {
  directory: string;
  env: string;
  output: string;
  path: string;
}

export function resolveRunnerTemp(
  env: Record<string, string>,
  fallback: string,
): string {
  return env.RUNNER_TEMP || fallback || tmpdir();
}

export async function createStepCommandFiles(
  env: Record<string, string>,
  fallbackTempDir: string,
): Promise<StepCommandFiles> {
  const runnerTemp = resolveRunnerTemp(env, fallbackTempDir);
  let directory: string;

  try {
    directory = await mkdtemp(join(runnerTemp, "actions-engine-step-"));
  } catch {
    directory = await mkdtemp(join(tmpdir(), "actions-engine-step-"));
  }

  return {
    directory,
    env: join(directory, "github-env"),
    output: join(directory, "github-output"),
    path: join(directory, "github-path"),
  };
}

export async function parseStepCommandFileOutputs(
  outputPath: string,
): Promise<Record<string, string>> {
  const outputContent = await readStepCommandFile(outputPath);
  if (outputContent.length === 0) {
    return {};
  }
  return parseGitHubEnvFile(outputContent);
}

export async function applyStepCommandFileEnvironmentUpdates(
  sharedEnv: Record<string, string>,
  commandFiles: StepCommandFiles,
  shellEnv: Record<string, string>,
): Promise<void> {
  const envContent = await readStepCommandFile(commandFiles.env);
  if (envContent.length > 0) {
    const updates = parseGitHubEnvFile(envContent);
    Object.assign(sharedEnv, updates);
  }

  const pathContent = await readStepCommandFile(commandFiles.path);
  const appendedPaths = parsePathFile(pathContent);
  if (appendedPaths.length > 0) {
    const basePath = sharedEnv.PATH ?? shellEnv.PATH ?? Deno.env.get("PATH") ??
      "";
    const prefix = appendedPaths.join(pathDelimiter);
    sharedEnv.PATH = basePath.length > 0
      ? `${prefix}${pathDelimiter}${basePath}`
      : prefix;
  }
}

export async function readStepCommandFile(path: string): Promise<string> {
  try {
    const { stat } = await import("node:fs/promises");
    const stats = await stat(path);
    if (stats.size > MAX_COMMAND_FILE_BYTES) {
      throw new Error(
        `Command file ${path} exceeds maximum size of ${MAX_COMMAND_FILE_BYTES} bytes (actual: ${stats.size})`,
      );
    }
    return await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export async function removeStepCommandFilesDirectory(
  path: string,
): Promise<void> {
  try {
    await rm(path, { recursive: true, force: true });
  } catch {
    // Command file cleanup should not fail the step.
  }
}
