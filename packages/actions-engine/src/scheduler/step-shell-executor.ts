import { spawn } from "node:child_process";

import type { Step } from "../workflow-models.ts";

export type ShellExecutor = (
  command: string,
  options: ShellExecutorOptions,
) => Promise<ShellExecutorResult>;

export interface ShellExecutorOptions {
  shell?: Step["shell"];
  workingDirectory?: string;
  env?: Record<string, string>;
  timeout?: number;
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

export const defaultShellExecutor: ShellExecutor = async (
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
      if (Deno.env.get(key)) {
        safeHostEnv[key] = Deno.env.get(key)!;
      }
    }

    const child = spawn(spawnFile, spawnArgs, {
      cwd: options.workingDirectory,
      env: {
        ...safeHostEnv,
        ...(options.env ?? {}),
      },
      shell: false,
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timeout = typeof options.timeout === "number" && options.timeout > 0
      ? setTimeout(() => {
        timedOut = true;
        child.kill();
      }, options.timeout)
      : undefined;

    if (timeout !== undefined) {
      Deno.unrefTimer(timeout);
    }

    child.stdout?.on("data", (chunk: string | Uint8Array) => {
      stdout += typeof chunk === "string"
        ? chunk
        : new TextDecoder().decode(chunk);
    });
    child.stderr?.on("data", (chunk: string | Uint8Array) => {
      stderr += typeof chunk === "string"
        ? chunk
        : new TextDecoder().decode(chunk);
    });

    child.on("error", (error) => {
      if (timeout) {
        clearTimeout(timeout);
      }
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (timeout) {
        clearTimeout(timeout);
      }

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
        stdout,
        stderr,
      });
    });
  });
};
