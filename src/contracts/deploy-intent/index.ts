import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, normalize } from "node:path";

export type DeployIntentDriver = "gitops";
export type DeployIntentMode = "apply" | "plan" | "destroy";

export interface DeployIntentGitOpsConfig {
  readonly driver: DeployIntentDriver;
  readonly remote: string;
  readonly token: string;
  readonly branch: string;
  readonly writePathPrefix: string;
  readonly authorName?: string;
  readonly authorEmail?: string;
}

export interface DeployIntentInput {
  readonly id: string;
  readonly mode?: DeployIntentMode;
  readonly appSpec: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
  readonly message?: string;
}

export interface DeployIntentResult {
  readonly driver: DeployIntentDriver;
  readonly remote: string;
  readonly branch: string;
  readonly path: string;
  readonly commit: string;
}

export interface DeployIntentClientOptions {
  readonly config: DeployIntentGitOpsConfig;
  readonly worktree?: string;
  readonly git?: GitRunner;
  readonly makeTempDir?: () => Promise<string>;
  readonly writeTextFile?: (path: string, data: string) => Promise<void>;
  readonly mkdir?: (
    path: string,
    options?: { recursive?: boolean },
  ) => Promise<void>;
  readonly remove?: (
    path: string,
    options?: { recursive?: boolean },
  ) => Promise<void>;
}

export interface GitRunOptions {
  /**
   * Extra environment variables for the git invocation. The deploy credential
   * is delivered here (via `GIT_CONFIG_*`) rather than as a process argument so
   * it never lands in argv (`/proc/<pid>/cmdline`, `ps`).
   */
  readonly env?: Readonly<Record<string, string>>;
}

export type GitRunner = (
  args: readonly string[],
  cwd: string,
  options?: GitRunOptions,
) => Promise<
  { readonly code: number; readonly stdout: string; readonly stderr?: string }
>;

export interface DeployIntentClient {
  write(input: DeployIntentInput): Promise<DeployIntentResult>;
}

export function parseDeployIntentEnv(
  env: Record<string, string | undefined>,
): DeployIntentGitOpsConfig | undefined {
  const driver = env.DEPLOY_INTENT_DRIVER;
  if (!driver) return undefined;
  if (driver !== "gitops") {
    throw new Error(`unsupported DEPLOY_INTENT_DRIVER '${driver}'`);
  }
  const remote = requiredEnv(env, "DEPLOY_INTENT_REMOTE");
  const token = requiredEnv(env, "DEPLOY_INTENT_TOKEN");
  return {
    driver: "gitops",
    remote,
    token,
    branch: env.DEPLOY_INTENT_BRANCH || "main",
    writePathPrefix: normalizePrefix(
      env.DEPLOY_INTENT_WRITE_PATH_PREFIX || "deployments",
    ),
    ...(env.DEPLOY_INTENT_AUTHOR_NAME
      ? { authorName: env.DEPLOY_INTENT_AUTHOR_NAME }
      : {}),
    ...(env.DEPLOY_INTENT_AUTHOR_EMAIL
      ? { authorEmail: env.DEPLOY_INTENT_AUTHOR_EMAIL }
      : {}),
  };
}

export function createDeployIntentClient(
  options: DeployIntentClientOptions,
): DeployIntentClient {
  return {
    write: (input: DeployIntentInput) => writeDeployIntent(options, input),
  };
}

export async function writeDeployIntent(
  options: DeployIntentClientOptions,
  input: DeployIntentInput,
): Promise<DeployIntentResult> {
  assertSafeIntentId(input.id);
  const config = options.config;
  const git = options.git ?? defaultGitRunner;
  const makeDirectory = options.mkdir ?? mkdir;
  const writeText = options.writeTextFile ?? writeFile;
  const remove = options.remove ?? removePath;
  const makeTempDir = options.makeTempDir ??
    (() => mkdtemp(join(tmpdir(), "takos-deploy-intent-")));
  const ownedWorktree = options.worktree ? undefined : await makeTempDir();
  const worktree = options.worktree ?? ownedWorktree!;
  const relativePath = `${config.writePathPrefix}/${input.id}.json`;
  const targetPath = join(worktree, relativePath);

  const authEnv = gitAuthEnv(config.token);

  try {
    if (!options.worktree) {
      await runGit(git, ".", [
        "clone",
        "--branch",
        config.branch,
        config.remote,
        worktree,
      ], { env: authEnv });
    }
    await makeDirectory(dirname(targetPath), { recursive: true });
    await writeText(
      targetPath,
      `${JSON.stringify(deployIntentDocument(input), null, 2)}\n`,
    );
    if (config.authorName) {
      await runGit(git, worktree, ["config", "user.name", config.authorName]);
    }
    if (config.authorEmail) {
      await runGit(git, worktree, [
        "config",
        "user.email",
        config.authorEmail,
      ]);
    }
    await runGit(git, worktree, ["add", relativePath]);
    await runGit(git, worktree, [
      "commit",
      "-m",
      input.message ?? `Deploy intent ${input.id}`,
    ]);
    const commit = (await runGit(git, worktree, ["rev-parse", "HEAD"]))
      .stdout.trim();
    await runGit(git, worktree, [
      "push",
      "origin",
      config.branch,
    ], { env: authEnv });
    return {
      driver: "gitops",
      remote: config.remote,
      branch: config.branch,
      path: relativePath,
      commit,
    };
  } finally {
    if (ownedWorktree) {
      await remove(ownedWorktree, { recursive: true }).catch(() => {});
    }
  }
}

function deployIntentDocument(
  input: DeployIntentInput,
): Record<string, unknown> {
  return {
    kind: "takos.deploy-intent@v1",
    id: input.id,
    mode: input.mode ?? "apply",
    ...(input.metadata ? { metadata: input.metadata } : {}),
    appSpec: input.appSpec,
  };
}

function requiredEnv(
  env: Record<string, string | undefined>,
  key: string,
): string {
  const value = env[key];
  if (!value) throw new Error(`${key} is required for gitops deploy intent`);
  return value;
}

function assertSafeIntentId(id: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(id)) {
    throw new Error("deploy intent id must be 1-128 safe path characters");
  }
}

function normalizePrefix(prefix: string): string {
  const normalized = normalize(prefix).replace(/^\/+/, "").replace(/\/+$/, "");
  if (
    !normalized || normalized === "." ||
    normalized.split("/").some((part) => part === "..")
  ) {
    throw new Error(
      "DEPLOY_INTENT_WRITE_PATH_PREFIX must stay inside the repo",
    );
  }
  return normalized;
}

/**
 * Build the environment that injects the deploy credential into git without
 * placing it in argv. `GIT_CONFIG_COUNT` / `GIT_CONFIG_KEY_*` / `GIT_CONFIG_VALUE_*`
 * is git's supported way to set config from the environment, equivalent to
 * `-c http.extraHeader=...` but invisible to `/proc/<pid>/cmdline` and `ps`.
 */
function gitAuthEnv(token: string): Readonly<Record<string, string>> {
  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.extraHeader",
    GIT_CONFIG_VALUE_0: `Authorization: Bearer ${token}`,
  };
}

async function runGit(
  git: GitRunner,
  cwd: string,
  args: readonly string[],
  options?: GitRunOptions,
): Promise<
  { readonly code: number; readonly stdout: string; readonly stderr?: string }
> {
  const result = await git(args, cwd, options);
  if (result.code !== 0) {
    // args no longer carry the credential, so they are safe to surface as-is.
    throw new Error(
      `git ${args.join(" ")} failed${
        result.stderr ? `: ${result.stderr}` : ""
      }`,
    );
  }
  return result;
}

async function defaultGitRunner(
  args: readonly string[],
  cwd: string,
  options?: GitRunOptions,
): Promise<
  { readonly code: number; readonly stdout: string; readonly stderr: string }
> {
  return await new Promise<
    { readonly code: number; readonly stdout: string; readonly stderr: string }
  >((resolve, reject) => {
    const child = spawn("git", [...args], {
      cwd,
      // Inherit the parent environment and overlay the credential-carrying
      // GIT_CONFIG_* vars so git keeps PATH/HOME/etc.
      env: options?.env ? { ...process.env, ...options.env } : process.env,
      windowsHide: true,
    });
    const stdout: Uint8Array[] = [];
    const stderr: Uint8Array[] = [];
    child.stdout.on("data", (chunk: Uint8Array | string) => {
      stdout.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    child.stderr.on("data", (chunk: Uint8Array | string) => {
      stderr.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      });
    });
  });
}

async function removePath(
  path: string,
  options?: { recursive?: boolean },
): Promise<void> {
  await rm(path, { recursive: options?.recursive, force: true });
}
