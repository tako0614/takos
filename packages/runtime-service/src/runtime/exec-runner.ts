import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
  ALLOWED_COMMANDS_SET,
  MAX_EXEC_OUTPUT_BYTES,
  MAX_EXEC_OUTPUT_TOTAL_BYTES,
  MAX_CONCURRENT_EXEC_PER_WORKSPACE,
} from '../shared/config.js';
import { pushLog } from './logging.js';
import { runCommand } from './command.js';
import { resolvePathWithin, verifyPathWithinAfterAccess } from './paths.js';
import { validateCommandLine } from './validation.js';
import { execTempDirManager } from '../utils/temp-dir.js';
import { getErrorMessage } from '@takos/common/errors';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExecInput {
  space_id: string;
  commands: string[];
  working_dir?: string;
  timeout?: number;
  env?: Record<string, string>;
  return_outputs?: string[];
  files?: Array<{ path: string; content: string }>;
}

export interface RuntimeProcess {
  id: string;
  space_id: string;
  status: 'running' | 'completed' | 'failed';
  output: string;
  error?: string;
  exit_code?: number;
  started_at: number;
  completed_at?: number;
}

export interface ExecResult {
  runtime_id: string;
  status: 'running' | 'completed' | 'failed';
  output: string;
  error?: string;
  exit_code?: number;
  output_files?: Array<{ path: string; content: string }>;
}

// ---------------------------------------------------------------------------
// Process tracker
// ---------------------------------------------------------------------------

const MAX_TRACKED_PROCESSES = 1000;
const COMPLETED_PROCESS_TTL_MS = 10 * 60 * 1000;
const RUNNING_PROCESS_TTL_MS = 2 * 60 * 60 * 1000;

const runtimeProcesses = new Map<string, RuntimeProcess>();

let cleanupRunning = false;

setInterval(() => {
  if (cleanupRunning) return;
  cleanupRunning = true;

  const now = Date.now();
  for (const [id, proc] of runtimeProcesses.entries()) {
    if (proc.status !== 'running') {
      const age = now - (proc.completed_at ?? proc.started_at);
      if (age > COMPLETED_PROCESS_TTL_MS) {
        runtimeProcesses.delete(id);
      }
    } else if (now - proc.started_at > RUNNING_PROCESS_TTL_MS) {
      proc.status = 'failed';
      proc.error = 'Process exceeded maximum TTL and was cleaned up';
      proc.completed_at = now;
      runtimeProcesses.delete(id);
    }
  }

  cleanupRunning = false;
}, 60 * 1000);

export function getProcess(id: string): RuntimeProcess | undefined {
  return runtimeProcesses.get(id);
}

export function isSpaceConcurrencyExceeded(spaceId: string): boolean {
  const runningCount = Array.from(runtimeProcesses.values())
    .filter(p => p.space_id === spaceId && p.status === 'running')
    .length;
  return runningCount >= MAX_CONCURRENT_EXEC_PER_WORKSPACE;
}

/** @deprecated Use {@link isSpaceConcurrencyExceeded} instead. */
export const isWorkspaceConcurrencyExceeded = isSpaceConcurrencyExceeded;

/**
 * Evict old completed processes when at capacity.
 * Returns true if there is room for a new process, false otherwise.
 */
export function ensureProcessCapacity(): boolean {
  if (runtimeProcesses.size < MAX_TRACKED_PROCESSES) return true;

  const completedProcesses = Array.from(runtimeProcesses.entries())
    .filter(([, p]) => p.status !== 'running')
    .sort((a, b) => a[1].started_at - b[1].started_at);

  const toRemove = Math.max(1, Math.floor(MAX_TRACKED_PROCESSES * 0.1));
  for (let i = 0; i < Math.min(toRemove, completedProcesses.length); i++) {
    runtimeProcesses.delete(completedProcesses[i][0]);
  }

  return runtimeProcesses.size < MAX_TRACKED_PROCESSES;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function sanitizeErrorMessage(err: unknown): string {
  const message = getErrorMessage(err);
  return message
    .replace(/\/[^\s:]+/g, '[path]')
    .replace(/[A-Z]:\\[^\s:]+/gi, '[path]')
    .replace(/\.\.\/[^\s:]+/g, '[path]')
    .replace(/\.\/[^\s:]+/g, '[path]');
}

function computeTimeout(requestedTimeout: unknown): number {
  const seconds =
    typeof requestedTimeout === 'number' && Number.isFinite(requestedTimeout)
      ? Math.floor(requestedTimeout)
      : 300;
  return Math.max(1, Math.min(seconds, 1800)) * 1000;
}

// ---------------------------------------------------------------------------
// Exec runner
// ---------------------------------------------------------------------------

async function writeInputFiles(
  tempDir: string,
  files: Array<{ path: string; content: string }>,
  logs: string[],
): Promise<void> {
  pushLog(logs, `Writing ${files.length} files...`);
  for (const file of files) {
    const localPath = resolvePathWithin(tempDir, file.path, 'file');
    await fs.mkdir(path.dirname(localPath), { recursive: true });
    await fs.writeFile(localPath, file.content, 'utf-8');
  }
  pushLog(logs, 'Files written successfully');
}

async function executeCommands(
  commands: string[],
  workingDir: string,
  logs: string[],
  env: Record<string, string> | undefined,
  timeoutMs: number,
): Promise<number> {
  let lastExitCode = 0;

  for (const cmd of commands) {
    const trimmedCmd = cmd.trim();
    validateCommandLine(trimmedCmd);
    const parts = trimmedCmd.split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);

    pushLog(logs, `$ ${trimmedCmd}`);

    if (!ALLOWED_COMMANDS_SET.has(command)) {
      pushLog(logs, `Error: Command not allowed: ${command}`);
      throw new Error(`Command not allowed: ${command}`);
    }

    const exitCode = await runCommand(command, args, {
      cwd: workingDir,
      logs,
      env,
      timeoutMs,
    });

    lastExitCode = exitCode;

    if (exitCode !== 0) {
      pushLog(logs, `Command exited with code ${exitCode}`);
    }
  }

  return lastExitCode;
}

async function collectOutputFiles(
  tempDir: string,
  returnOutputs: string[],
  logs: string[],
): Promise<Array<{ path: string; content: string }>> {
  const outputFiles: Array<{ path: string; content: string }> = [];
  let totalOutputBytes = 0;

  for (const outputPath of returnOutputs) {
    const localPath = resolvePathWithin(tempDir, outputPath, 'output');
    try {
      const stats = await fs.stat(localPath);
      if (stats.size > MAX_EXEC_OUTPUT_BYTES) {
        pushLog(logs, `Warning: Output too large, skipped: ${outputPath}`);
        continue;
      }
      if (totalOutputBytes + stats.size > MAX_EXEC_OUTPUT_TOTAL_BYTES) {
        pushLog(logs, 'Warning: Output size cap reached, skipping remaining files');
        break;
      }
      const content = await fs.readFile(localPath, 'utf-8');
      outputFiles.push({ path: outputPath, content });
      totalOutputBytes += stats.size;
      pushLog(logs, `Read output: ${outputPath}`);
    } catch (err) {
      pushLog(logs, `Warning: Could not read ${outputPath}: ${err}`);
    }
  }

  return outputFiles;
}

/**
 * Run exec commands in a temp directory and return the result.
 */
export async function runExec(
  input: ExecInput,
): Promise<ExecResult> {
  const processId = `proc-${crypto.randomUUID()}`;
  const timeout = computeTimeout(input.timeout);

  const proc: RuntimeProcess = {
    id: processId,
    space_id: input.space_id,
    status: 'running',
    output: '',
    started_at: Date.now(),
  };
  runtimeProcesses.set(processId, proc);

  const logs: string[] = [];
  let outputFiles: Array<{ path: string; content: string }> = [];
  let tempDir: string | null = null;

  try {
    tempDir = await execTempDirManager.createTempDirWithCleanup(
      `takos-exec-${input.space_id.slice(0, 8)}-`
    );

    if (input.files && input.files.length > 0) {
      await writeInputFiles(tempDir, input.files, logs);
    }

    const workingDir = input.working_dir
      ? resolvePathWithin(tempDir, input.working_dir, 'working_dir', true)
      : tempDir;

    await fs.mkdir(workingDir, { recursive: true });
    await verifyPathWithinAfterAccess(tempDir, workingDir, 'working_dir');

    const lastExitCode = await executeCommands(
      input.commands,
      workingDir,
      logs,
      input.env,
      timeout,
    );

    if (input.return_outputs && input.return_outputs.length > 0) {
      outputFiles = await collectOutputFiles(tempDir, input.return_outputs, logs);
    }

    proc.status = lastExitCode === 0 ? 'completed' : 'failed';
    proc.exit_code = lastExitCode;
    proc.output = logs.join('\n');
    proc.completed_at = Date.now();
  } catch (err) {
    proc.status = 'failed';
    proc.error = sanitizeErrorMessage(err);
    proc.output = logs.join('\n');
    proc.completed_at = Date.now();
  } finally {
    if (tempDir) {
      await execTempDirManager.cleanupTempDir(tempDir);
    }
  }

  setTimeout(() => {
    runtimeProcesses.delete(processId);
  }, COMPLETED_PROCESS_TTL_MS).unref();

  return {
    runtime_id: processId,
    status: proc.status,
    output: proc.output,
    error: proc.error,
    exit_code: proc.exit_code,
    output_files: outputFiles.length > 0 ? outputFiles : undefined,
  };
}
