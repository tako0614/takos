import { execFile } from "node:child_process";

export type CommandRunnerOptions = {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdin?: string;
};

export type CommandRunnerResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
};

export type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandRunnerOptions,
) => Promise<CommandRunnerResult>;

const SAFE_HOST_ENV_KEYS = [
  "PATH",
  "HOME",
  "USER",
  "USERNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LC_MESSAGES",
  "LANGUAGE",
  "TZ",
  "TMPDIR",
  "TMP",
  "TEMP",
  "CI",
];

function buildBaseCommandEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of SAFE_HOST_ENV_KEYS) {
    const value = Deno.env.get(key);
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

export function pickHostCommandEnv(keys: readonly string[]): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const key of keys) {
    const value = Deno.env.get(key);
    if (value !== undefined) {
      env[key] = value;
    }
  }
  return env;
}

export const execCommand: CommandRunner = (
  command,
  args,
  options,
) =>
  new Promise((resolve) => {
    const proc = execFile(command, args, {
      cwd: options?.cwd,
      env: { ...buildBaseCommandEnv(), ...options?.env },
      maxBuffer: 10 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      const errorCode = error
        ? (error as { code?: number | string }).code
        : undefined;
      resolve({
        stdout: String(stdout || ""),
        stderr: String(stderr || ""),
        exitCode: typeof errorCode === "number" ? errorCode : 1,
      });
    });

    if (options?.stdin && proc.stdin) {
      proc.stdin.write(options.stdin);
      proc.stdin.end();
    }
  });
