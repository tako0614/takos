import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import { pushLog } from "../logging.ts";
import { SANDBOX_LIMITS } from "../../shared/config.ts";
import { getErrorMessage } from "takos-common/errors";
import { createLogger } from "takos-common/logger";
import { gracefulKill } from "../../utils/process-kill.ts";

const logger = createLogger({ service: "process-spawner" });
import type { ExecutorStepResult } from "./executor.ts";
import type { Buffer } from "node:buffer";

const COMMAND_FILE_MAX_BYTES = 5 * 1024 * 1024;
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OUTPUT_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const UNSAFE_OBJECT_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const BLOCKED_ENV_KEYS = new Set([
  "BASH_ENV",
  "ENV",
  "GITHUB_ENV",
  "GITHUB_OUTPUT",
  "GITHUB_PATH",
  "GITHUB_STEP_SUMMARY",
  "IFS",
  "LD_AUDIT",
  "LD_LIBRARY_PATH",
  "LD_PRELOAD",
  "NODE_OPTIONS",
  "PATH",
  "RUNNER_TEMP",
  "RUNNER_TOOL_CACHE",
  "SHELLOPTS",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CommandFiles {
  output: string;
  env: string;
  path: string;
  summary: string;
}

interface PreparedCommandFiles {
  envVars: Record<string, string>;
  files: CommandFiles;
}

interface SpawnOptions {
  timeout: number;
  cwd: string;
  shell?: boolean;
}

interface SpawnContext {
  env: Record<string, string>;
  logs: string[];
  outputs: Record<string, string>;
  workspacePath: string;
  parseWorkflowCommands: (text: string) => void;
  parseKeyValueFile: (content: string) => Record<string, string>;
  parsePathFile: (content: string) => string[];
}

function hasControlCharacters(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function isSafeObjectKey(key: string): boolean {
  return !UNSAFE_OBJECT_KEYS.has(key);
}

function isBlockedEnvKey(key: string): boolean {
  const upper = key.toUpperCase();
  return BLOCKED_ENV_KEYS.has(upper) ||
    upper.startsWith("GITHUB_") ||
    upper.startsWith("RUNNER_") ||
    upper.startsWith("DYLD_");
}

function sanitizeKeyValueEntries(
  entries: Record<string, string>,
  kind: "env" | "output",
  logs: string[],
): Record<string, string> {
  const result: Record<string, string> = {};
  const keyPattern = kind === "env" ? ENV_KEY_PATTERN : OUTPUT_KEY_PATTERN;

  for (const [key, value] of Object.entries(entries)) {
    if (!isSafeObjectKey(key) || !keyPattern.test(key)) {
      pushLog(logs, `[WARNING] Ignored invalid command file ${kind} key`);
      continue;
    }
    if (kind === "env" && isBlockedEnvKey(key)) {
      pushLog(logs, `[WARNING] Ignored blocked command file env key: ${key}`);
      continue;
    }
    if (value.length > SANDBOX_LIMITS.maxEnvValueLength) {
      pushLog(logs, `[WARNING] Ignored oversized command file ${kind}: ${key}`);
      continue;
    }
    result[key] = value;
  }

  return result;
}

async function readCommandFile(filePath: string): Promise<string> {
  try {
    const stat = await fs.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      logger.warn("Ignored unsafe command file", { filePath });
      return "";
    }
    if (stat.size > COMMAND_FILE_MAX_BYTES) {
      logger.warn("Ignored oversized command file", {
        filePath,
        size: stat.size,
        maxBytes: COMMAND_FILE_MAX_BYTES,
      });
      return "";
    }
    return await fs.readFile(filePath, "utf-8");
  } catch (e) {
    logger.warn("Failed to read command file", {
      filePath,
      error: String(e),
    });
    return "";
  }
}

async function sanitizePathEntries(
  entries: string[],
  logs: string[],
): Promise<string[]> {
  const result: string[] = [];
  for (const entry of entries) {
    if (
      !path.isAbsolute(entry) ||
      hasControlCharacters(entry) ||
      entry.includes(path.delimiter)
    ) {
      pushLog(logs, "[WARNING] Ignored unsafe command file PATH entry");
      continue;
    }

    try {
      const stat = await fs.lstat(entry);
      if (!stat.isDirectory()) {
        pushLog(
          logs,
          "[WARNING] Ignored non-directory command file PATH entry",
        );
        continue;
      }
    } catch {
      pushLog(logs, "[WARNING] Ignored missing command file PATH entry");
      continue;
    }

    result.push(entry);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Result builders
// ---------------------------------------------------------------------------

export function failureResult(
  stderr: string,
  outputs: Record<string, string> = {},
  exitCode: number = 1,
): ExecutorStepResult {
  return { exitCode, stdout: "", stderr, outputs, conclusion: "failure" };
}

export function successResult(
  stdout: string,
  outputs: Record<string, string>,
): ExecutorStepResult {
  return { exitCode: 0, stdout, stderr: "", outputs, conclusion: "success" };
}

// ---------------------------------------------------------------------------
// Command file management
// ---------------------------------------------------------------------------

export async function prepareCommandFiles(
  workspacePath: string,
): Promise<PreparedCommandFiles> {
  const commandDir = path.join(workspacePath, ".runner", "commands");
  await fs.mkdir(commandDir, { recursive: true });

  const id = randomUUID();
  const files: CommandFiles = {
    output: path.join(commandDir, `output-${id}.txt`),
    env: path.join(commandDir, `env-${id}.txt`),
    path: path.join(commandDir, `path-${id}.txt`),
    summary: path.join(commandDir, `summary-${id}.md`),
  };

  await Promise.all(Object.values(files).map((f) => fs.writeFile(f, "")));

  return {
    envVars: {
      GITHUB_OUTPUT: files.output,
      GITHUB_ENV: files.env,
      GITHUB_PATH: files.path,
      GITHUB_STEP_SUMMARY: files.summary,
    },
    files,
  };
}

export async function applyCommandFiles(
  prepared: PreparedCommandFiles,
  ctx: SpawnContext,
): Promise<void> {
  const [outputContent, envContent, pathContent] = await Promise.all([
    readCommandFile(prepared.files.output),
    readCommandFile(prepared.files.env),
    readCommandFile(prepared.files.path),
  ]);

  if (outputContent) {
    Object.assign(
      ctx.outputs,
      sanitizeKeyValueEntries(
        ctx.parseKeyValueFile(outputContent),
        "output",
        ctx.logs,
      ),
    );
  }
  if (envContent) {
    Object.assign(
      ctx.env,
      sanitizeKeyValueEntries(
        ctx.parseKeyValueFile(envContent),
        "env",
        ctx.logs,
      ),
    );
  }
  if (pathContent) {
    for (
      const entry of await sanitizePathEntries(
        ctx.parsePathFile(pathContent),
        ctx.logs,
      )
    ) {
      ctx.env.PATH = ctx.env.PATH
        ? ctx.env.PATH + path.delimiter + entry
        : entry;
    }
  }
}

export async function cleanupCommandFiles(
  prepared: PreparedCommandFiles,
): Promise<void> {
  await Promise.all(
    Object.values(prepared.files).map((f) => fs.rm(f, { force: true })),
  );
}

// ---------------------------------------------------------------------------
// Runtime env construction
// ---------------------------------------------------------------------------

export function createRuntimeEnv(
  env: Record<string, string>,
  workspacePath: string,
  commandFileEnv: Record<string, string>,
): Record<string, string> {
  const runnerBase = path.join(workspacePath, ".runner");
  const runtimeEnv: Record<string, string> = {
    ...env,
    ...commandFileEnv,
    RUNNER_TEMP: path.join(runnerBase, "temp"),
    RUNNER_TOOL_CACHE: path.join(runnerBase, "tool-cache"),
  };

  for (const key of ["PATH", "HOME"] as const) {
    if (!runtimeEnv[key] && Deno.env.get(key)) {
      runtimeEnv[key] = Deno.env.get(key)!;
    }
  }

  const existingNodeOpts = runtimeEnv.NODE_OPTIONS || "";
  if (!existingNodeOpts.includes("--max-old-space-size")) {
    runtimeEnv.NODE_OPTIONS = `${existingNodeOpts} --max-old-space-size=2048`
      .trim();
  }

  return runtimeEnv;
}

// ---------------------------------------------------------------------------
// Process spawning
// ---------------------------------------------------------------------------

function handleStdoutData(
  data: Buffer,
  state: { stdout: string },
  child: ChildProcess,
  ctx: SpawnContext,
): void {
  const text = data.toString("utf-8");
  state.stdout += text;
  if (state.stdout.length > SANDBOX_LIMITS.maxOutputSize) {
    pushLog(ctx.logs, "[WARNING] Output size limit exceeded, truncating...");
    state.stdout = state.stdout.slice(0, SANDBOX_LIMITS.maxOutputSize);
    child.kill("SIGTERM");
  }
  ctx.parseWorkflowCommands(text);
}

function handleStderrData(
  data: Buffer,
  state: { stderr: string },
): void {
  const text = data.toString("utf-8");
  state.stderr += text;
  if (state.stderr.length > SANDBOX_LIMITS.maxOutputSize) {
    state.stderr = state.stderr.slice(0, SANDBOX_LIMITS.maxOutputSize);
  }
}

export async function spawnWithTimeout(
  command: string,
  args: string[],
  options: SpawnOptions,
  ctx: SpawnContext,
): Promise<ExecutorStepResult> {
  ctx.outputs = {};
  ctx.logs = [];
  const prepared = await prepareCommandFiles(ctx.workspacePath);

  return new Promise((resolve) => {
    const state = { stdout: "", stderr: "", isTimedOut: false };
    let child: ChildProcess;

    try {
      child = spawn(command, args, {
        cwd: options.cwd,
        env: createRuntimeEnv(ctx.env, ctx.workspacePath, prepared.envVars),
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
        shell: options.shell === true ? true : false,
      });
    } catch (err) {
      void cleanupCommandFiles(prepared);
      resolve(
        failureResult(
          `Failed to spawn process: ${getErrorMessage(err)}`,
          ctx.outputs,
        ),
      );
      return;
    }

    let forceKillHandle: ReturnType<typeof setTimeout> | undefined;
    const timeoutHandle = setTimeout(() => {
      state.isTimedOut = true;
      pushLog(
        ctx.logs,
        `[TIMEOUT] Command timed out after ${options.timeout}ms`,
      );
      forceKillHandle = gracefulKill(child);
    }, options.timeout);

    function clearTimers(): void {
      clearTimeout(timeoutHandle);
      if (forceKillHandle) clearTimeout(forceKillHandle);
    }

    child.stdout?.on("data", (data: Buffer) => {
      handleStdoutData(data, state, child, ctx);
    });
    child.stdout?.on("error", (err) => {
      state.stderr += `\nstdout stream error: ${err.message}`;
    });

    child.stderr?.on("data", (data: Buffer) => {
      handleStderrData(data, state);
    });
    child.stderr?.on("error", (err) => {
      state.stderr += `\nstderr stream error: ${err.message}`;
    });

    child.on("error", (err) => {
      clearTimers();
      void cleanupCommandFiles(prepared);
      resolve({
        exitCode: 1,
        stdout: state.stdout,
        stderr: state.stderr + `\nSpawn error: ${err.message}`,
        outputs: ctx.outputs,
        conclusion: "failure",
      });
    });

    child.on("close", (code, signal) => {
      clearTimers();
      void (async () => {
        try {
          await applyCommandFiles(prepared, ctx);
        } catch (err) {
          pushLog(
            ctx.logs,
            `[WARNING] Failed to parse command files: ${getErrorMessage(err)}`,
          );
        }
        await cleanupCommandFiles(prepared);

        if (state.isTimedOut) {
          resolve({
            exitCode: 124,
            stdout: state.stdout,
            stderr: state.stderr + "\nCommand timed out",
            outputs: ctx.outputs,
            conclusion: "failure",
          });
          return;
        }

        const exitCode = code ?? (signal ? 128 : 1);
        resolve({
          exitCode,
          stdout: state.stdout,
          stderr: state.stderr,
          outputs: ctx.outputs,
          conclusion: exitCode === 0 ? "success" : "failure",
        });
      })();
    });
  });
}
