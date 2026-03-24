import { spawn, type ChildProcess } from 'child_process';
import { Readable } from 'stream';
import { pushLog } from './logging.js';
import { filterSafeEnv } from '../utils/env-filter.js';

function gracefulKill(child: ChildProcess): NodeJS.Timeout {
  child.kill('SIGTERM');
  return setTimeout(() => {
    const stillRunning = child.exitCode === null && child.signalCode === null;
    if (stillRunning) {
      child.kill('SIGKILL');
    }
  }, 5000);
}

const DEFAULT_COMMAND_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_COMMAND_TIMEOUT_MS = 24 * 60 * 60 * 1000;

const MAX_CHILD_MEMORY_MB = 2048;
const MAX_STDOUT_BUFFER_BYTES = 50 * 1024 * 1024;
const MAX_STDERR_BUFFER_BYTES = 10 * 1024 * 1024;

const DENIED_ENV_KEYS = new Set([
  'NODE_OPTIONS', 'LD_PRELOAD', 'LD_LIBRARY_PATH', 'DYLD_INSERT_LIBRARIES',
  'BASH_ENV', 'ENV', 'CDPATH', 'PYTHONSTARTUP', 'PERL5OPT', 'RUBYOPT',
  'PYTHONPATH', 'GIT_ASKPASS', 'SSH_ASKPASS', 'PROMPT_COMMAND',
  'BASH_FUNC_PERCENT_AT_PERCENT', 'BASHOPTS', 'SHELLOPTS',
  'PS1', 'PS2', 'PS3', 'PS4',
]);

class CommandTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(`Command '${command}' timed out after ${timeoutMs}ms`);
    this.name = 'CommandTimeoutError';
  }
}

function pipeStreamToLogs(
  stream: Readable,
  logs: string[],
  maxBytes: number,
  streamName: string
): void {
  let totalBytes = 0;
  let truncated = false;

  stream.on('data', (data: Buffer) => {
    totalBytes += data.length;
    if (totalBytes > maxBytes) {
      if (!truncated) {
        truncated = true;
        pushLog(logs, `[WARNING] ${streamName} exceeded ${maxBytes} bytes, further output truncated`);
      }
      return;
    }
    for (const line of data.toString('utf-8').split('\n')) {
      if (line.trim().length > 0) {
        pushLog(logs, line);
      }
    }
  });
  stream.on('error', (err) => {
    pushLog(logs, `[WARNING] ${streamName} stream error: ${err.message}`);
  });
}

function sanitizeUserEnv(userEnv: Record<string, string | undefined>): Record<string, string | undefined> {
  const sanitized = { ...userEnv };
  for (const key of Object.keys(sanitized)) {
    if (DENIED_ENV_KEYS.has(key) || key.startsWith('BASH_FUNC_')) {
      delete sanitized[key];
    }
  }
  delete sanitized['PATH'];
  return sanitized;
}

export function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; logs: string[]; env?: NodeJS.ProcessEnv; timeoutMs?: number }
): Promise<number> {
  return new Promise((resolve, reject) => {
    const timeoutMs = Math.min(options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS, MAX_COMMAND_TIMEOUT_MS);

    let isTimedOut = false;

    const childEnv = {
      ...filterSafeEnv(process.env),
      ...sanitizeUserEnv(options.env ?? {}),
      NODE_OPTIONS: `--max-old-space-size=${MAX_CHILD_MEMORY_MB}`,
    };

    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: childEnv,
    });

    let forceKillHandle: NodeJS.Timeout | undefined;
    const timeoutHandle = setTimeout(() => {
      isTimedOut = true;
      pushLog(options.logs, `[TIMEOUT] Command timed out after ${timeoutMs}ms, killing process...`);
      forceKillHandle = gracefulKill(child);
    }, timeoutMs);

    pipeStreamToLogs(child.stdout, options.logs, MAX_STDOUT_BUFFER_BYTES, 'stdout');
    pipeStreamToLogs(child.stderr, options.logs, MAX_STDERR_BUFFER_BYTES, 'stderr');

    function cleanup(): void {
      clearTimeout(timeoutHandle);
      if (forceKillHandle) clearTimeout(forceKillHandle);
    }

    child.on('error', (err) => {
      cleanup();
      reject(err);
    });

    child.on('close', (code, signal) => {
      cleanup();
      if (isTimedOut) {
        reject(new CommandTimeoutError(command, timeoutMs));
        return;
      }
      resolve(code ?? (signal ? 128 : 1));
    });
  });
}
