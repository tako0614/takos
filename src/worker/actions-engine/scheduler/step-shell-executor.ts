import { deleteEnv, envObject, getEnv, setEnv } from "@takos/worker-platform-utils/runtime-env";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";

import type { Step } from "../workflow-models.ts";
import process from "node:process";

const DEFAULT_STDOUT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_STDERR_MAX_BYTES = 5 * 1024 * 1024;
const FORCE_KILL_TIMEOUT_MS = 5_000;

/**
 * テキスト内の秘密情報文字列を `***` に置換する。
 *
 * - 空文字 / undefined は通さず素通し
 * - 複数回マッチしても全て置換
 * - 長い secret を先に置換して部分マッチによる書き換えを回避
 */
export function maskSecretsInText(
  text: string | undefined,
  secrets: readonly string[],
): string {
  if (text === undefined || text === null) {
    return "";
  }
  if (secrets.length === 0) {
    return text;
  }

  // より長い値から置換して重複マスクの副作用を避ける
  const sortedSecrets = [...secrets]
    .filter((value) => typeof value === "string" && value.length > 0)
    .sort((a, b) => b.length - a.length);

  let result = text;
  for (const secret of sortedSecrets) {
    if (!secret) continue;
    // 文字列全体を置換（正規表現メタ文字をエスケープ）
    const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(escaped, "g"), "***");
  }
  return result;
}

export type ShellExecutor = (
  command: string,
  options: ShellExecutorOptions,
) => Promise<ShellExecutorResult>;

export interface ShellExecutorOptions {
  shell?: Step["shell"];
  workingDirectory?: string;
  env?: Record<string, string>;
  timeout?: number;
  maxStdoutBytes?: number;
  maxStderrBytes?: number;
}

export interface ShellExecutorResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export function resolvePlatformDefaultShell(): Step["shell"] {
  return process.platform === "win32" ? "pwsh" : "bash";
}

function resolveShellExecutable(
  shell: Step["shell"] | undefined,
): string | true {
  if (!shell) {
    return true;
  }

  switch (shell) {
    case "cmd":
      return process.platform === "win32" ? "cmd.exe" : "cmd";
    case "powershell":
      return process.platform === "win32" ? "powershell.exe" : "powershell";
    default:
      return shell;
  }
}

function appendStderrMessage(stderr: string, message: string): string {
  return stderr.length > 0 ? `${stderr}\n${message}` : message;
}

function appendStreamMessage(output: string, message: string): string {
  return output.length > 0 ? `${output}\n${message}` : message;
}

function resolveMaxOutputBytes(
  value: number | undefined,
  fallback: number,
): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

type OutputState = {
  text: string;
  bytes: number;
  truncated: boolean;
};

function decodeOutputChunk(chunk: string | Uint8Array): string {
  return typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
}

function appendOutputChunk(
  state: OutputState,
  chunk: string | Uint8Array,
  maxBytes: number,
  streamName: "stdout" | "stderr",
) {
  if (state.truncated) {
    return;
  }

  const text = decodeOutputChunk(chunk);
  const chunkBytes = Buffer.byteLength(text, "utf8");
  const remainingBytes = maxBytes - state.bytes;

  if (remainingBytes <= 0) {
    state.text = appendStreamMessage(
      state.text,
      `${streamName} truncated after ${maxBytes} bytes`,
    );
    state.truncated = true;
    return;
  }

  if (chunkBytes <= remainingBytes) {
    state.text += text;
    state.bytes += chunkBytes;
    return;
  }

  state.text += Buffer.from(text, "utf8").subarray(0, remainingBytes).toString(
    "utf8",
  );
  state.bytes = maxBytes;
  state.text = appendStreamMessage(
    state.text,
    `${streamName} truncated after ${maxBytes} bytes`,
  );
  state.truncated = true;
}

function killChildProcess(
  child: ReturnType<typeof spawn>,
  signal: "SIGTERM" | "SIGKILL",
) {
  if (child.pid === undefined || process.platform === "win32") {
    child.kill(signal);
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function terminateChildProcess(
  child: ReturnType<typeof spawn>,
): ReturnType<typeof setTimeout> {
  killChildProcess(child, "SIGTERM");
  const forceKill = setTimeout(() => {
    const stillRunning = child.exitCode === null && child.signalCode === null;
    if (stillRunning) {
      killChildProcess(child, "SIGKILL");
    }
  }, FORCE_KILL_TIMEOUT_MS);
  unrefTimer(forceKill);
  return forceKill;
}

function unrefTimer(timer: ReturnType<typeof setTimeout>): void {
  (timer as ReturnType<typeof setTimeout> & { unref?: () => void }).unref?.();
}

export const defaultShellExecutor: ShellExecutor = (
  command: string,
  options: ShellExecutorOptions,
): Promise<ShellExecutorResult> => {
  return new Promise<ShellExecutorResult>((resolve, reject) => {
    const shellExecutable = resolveShellExecutable(options.shell);
    let spawnFile: string;
    let spawnArgs: string[];

    if (shellExecutable === true) {
      if (process.platform === "win32") {
        spawnFile = "cmd.exe";
        spawnArgs = ["/d", "/s", "/c", command];
      } else {
        spawnFile = "/bin/sh";
        spawnArgs = ["-c", command];
      }
    } else {
      if (shellExecutable === "cmd.exe" || shellExecutable === "cmd") {
        spawnArgs = ["/d", "/s", "/c", command];
      } else if (
        shellExecutable === "powershell.exe" ||
        shellExecutable === "powershell" ||
        shellExecutable === "pwsh"
      ) {
        spawnArgs = ["-NonInteractive", "-Command", command];
      } else {
        spawnArgs = ["-c", command];
      }
      spawnFile = shellExecutable;
    }

    const safeHostEnv: Record<string, string> = {};
    const ALLOWED_HOST_VARS = [
      "PATH",
      "HOME",
      "USER",
      "SHELL",
      "LANG",
      "LC_ALL",
      "LC_CTYPE",
      "TERM",
      "TMPDIR",
      "TMP",
      "TEMP",
      "HOSTNAME",
      "NODE_ENV",
      "CI",
    ];
    for (const key of ALLOWED_HOST_VARS) {
      if (getEnv(key)) {
        safeHostEnv[key] = getEnv(key)!;
      }
    }

    const child = spawn(spawnFile, spawnArgs, {
      cwd: options.workingDirectory,
      env: {
        ...safeHostEnv,
        ...(options.env ?? {}),
      },
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
    });

    const stdoutState: OutputState = { text: "", bytes: 0, truncated: false };
    const stderrState: OutputState = { text: "", bytes: 0, truncated: false };
    const maxStdoutBytes = resolveMaxOutputBytes(
      options.maxStdoutBytes,
      DEFAULT_STDOUT_MAX_BYTES,
    );
    const maxStderrBytes = resolveMaxOutputBytes(
      options.maxStderrBytes,
      DEFAULT_STDERR_MAX_BYTES,
    );
    let timedOut = false;
    let forceKill: ReturnType<typeof setTimeout> | undefined;

    const timeout = typeof options.timeout === "number" && options.timeout > 0
      ? setTimeout(() => {
        timedOut = true;
        forceKill = terminateChildProcess(child);
      }, options.timeout)
      : undefined;

    if (timeout !== undefined) {
      unrefTimer(timeout);
    }

    child.stdout?.on("data", (chunk: string | Uint8Array) => {
      appendOutputChunk(stdoutState, chunk, maxStdoutBytes, "stdout");
    });
    child.stderr?.on("data", (chunk: string | Uint8Array) => {
      appendOutputChunk(stderrState, chunk, maxStderrBytes, "stderr");
    });

    child.on("error", (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (forceKill) {
        clearTimeout(forceKill);
      }
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (forceKill) {
        clearTimeout(forceKill);
      }

      let stderr = stderrState.text;

      const exitCode = typeof code === "number"
        ? code
        : timedOut
        ? 124
        : signal
        ? 128
        : 1;

      if (timedOut) {
        const timeoutMessage = `Command timed out after ${options.timeout}ms`;
        stderr = appendStderrMessage(stderr, timeoutMessage);
      } else if (signal) {
        const signalMessage = `Process terminated by signal: ${signal}`;
        stderr = appendStderrMessage(stderr, signalMessage);
      }

      resolve({
        exitCode,
        stdout: stdoutState.text,
        stderr,
      });
    });
  });
};
