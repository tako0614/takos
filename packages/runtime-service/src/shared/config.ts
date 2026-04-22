import os from "node:os";
import { parseIntEnv } from "takos-common/env-parse";

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  return value;
}

function optionalEnv(name: string, fallback = ""): string {
  return Deno.env.get(name) || fallback;
}

function optionalEnvAny(names: string[], fallback = ""): string {
  for (const name of names) {
    const value = Deno.env.get(name);
    if (value) return value;
  }
  return fallback;
}

export const PORT = parseIntEnv("PORT", 8080, { min: 1, max: 65535 });

export const R2_ACCOUNT_ID = optionalEnv("R2_ACCOUNT_ID");
export const R2_ACCESS_KEY_ID = optionalEnv("R2_ACCESS_KEY_ID");
export const R2_SECRET_ACCESS_KEY = optionalEnv("R2_SECRET_ACCESS_KEY");
export const S3_ENDPOINT = optionalEnvAny(
  ["S3_ENDPOINT"],
  R2_ACCOUNT_ID ? `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : "",
);
export const S3_REGION = optionalEnvAny(
  ["S3_REGION"],
  R2_ACCOUNT_ID ? "auto" : "us-east-1",
);
export const S3_ACCESS_KEY_ID = optionalEnvAny([
  "S3_ACCESS_KEY_ID",
  "R2_ACCESS_KEY_ID",
]);
export const S3_SECRET_ACCESS_KEY = optionalEnvAny([
  "S3_SECRET_ACCESS_KEY",
  "R2_SECRET_ACCESS_KEY",
]);
export const S3_BUCKET = optionalEnvAny(
  ["S3_BUCKET", "R2_BUCKET"],
  "takos-tenant-source",
);
export const R2_BUCKET = S3_BUCKET;
export const OBJECT_STORAGE_CONFIGURED = Boolean(
  optionalEnvAny([
    "S3_BUCKET",
    "R2_BUCKET",
    "S3_ENDPOINT",
    "R2_ACCOUNT_ID",
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
  ]),
);

export const TAKOS_API_URL = requireEnv("TAKOS_API_URL");
export const PROXY_BASE_URL = optionalEnv("PROXY_BASE_URL");
export const GIT_ENDPOINT_URL = optionalEnv(
  "GIT_ENDPOINT_URL",
  "https://git.takos.jp",
);

const rawJwtPublicKey = Deno.env.get("JWT_PUBLIC_KEY")
  ? Deno.env.get("JWT_PUBLIC_KEY")!.replace(/\\n/g, "\n").trim()
  : "";
export const JWT_PUBLIC_KEY = rawJwtPublicKey.length > 0 ? rawJwtPublicKey : "";

export const MAX_LOG_LINES = 100_000;
export const HEARTBEAT_INTERVAL_MS = 30 * 1000;

export const MAX_EXEC_COMMANDS = 50;
export const MAX_EXEC_FILES = 1000;
export const MAX_EXEC_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_EXEC_TOTAL_BYTES = 100 * 1024 * 1024;
export const MAX_EXEC_OUTPUTS = 50;
export const MAX_EXEC_OUTPUT_BYTES = 5 * 1024 * 1024;
export const MAX_EXEC_OUTPUT_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_SESSION_FILE_READ_BYTES = 5 * 1024 * 1024;

export const MAX_R2_DOWNLOAD_FILE_BYTES = 500 * 1024 * 1024;
export const MAX_R2_DOWNLOAD_TOTAL_BYTES = 2 * 1024 * 1024 * 1024;

// Security policy (command allowlist and blocklist)

const BASE_COMMANDS = [
  "npm",
  "npx",
  "node",
  "pnpm",
  "yarn",
  "bun",
  "git",
  "esbuild",
  "wrangler",
  "takos",
  "echo",
  "ls",
  "cat",
  "pwd",
  "mkdir",
  "cp",
  "mv",
  "rm",
  "touch",
  "chmod",
  "chown",
  "head",
  "tail",
  "grep",
  "find",
  "sort",
  "uniq",
  "wc",
  "diff",
  "tar",
  "unzip",
  "gzip",
  "gunzip",
  "zip",
  "sed",
  "awk",
  "xargs",
  "env",
  "which",
  "whereis",
  "file",
  "basename",
  "dirname",
  "realpath",
  "readlink",
  "tsc",
  "webpack",
  "vite",
  "jest",
  "vitest",
  "mocha",
  "ps",
  "top",
  "curl",
  "wget",
];

const EXTENDED_COMMANDS = [
  "kill",
  "killall",
  "pkill",
  "printenv",
];

const IS_EXTENDED_PROFILE = Deno.env.get("COMMAND_PROFILE") === "extended";

export const ALLOWED_COMMANDS_SET = new Set(
  IS_EXTENDED_PROFILE
    ? [...BASE_COMMANDS, ...EXTENDED_COMMANDS]
    : [...BASE_COMMANDS],
);

export const COMMAND_BLOCKLIST_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?[/\\]\*?\s*$/i, // rm -rf / or rm -rf /*
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?[/\\]\s/i, // rm -rf / (followed by more)
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+)?~[/\s]*$/i, // rm -rf ~ or rm -rf ~/
  /\breboot\b/i,
  /\bshutdown\b/i,
  /\bpoweroff\b/i,
  /\bhalt\b/i,
  /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}/, // fork bomb
  /\bdd\b.*\bof=\/dev\//i, // dd to device
  /\bmkfs\b/i, // format filesystem
  /\bchmod\s+(-[a-zA-Z]*\s+)?[0-7]*777\s+[/\\]/i, // chmod 777 on system dirs
  /\bmount\b/i, // mount operations
  /\bumount\b/i, // unmount operations
  // Block access to cloud metadata endpoints (SSRF prevention)
  /\b(curl|wget)\b.*\b169\.254\.169\.254\b/i,
  /\b(curl|wget)\b.*\bmetadata\.google\.internal\b/i,
  /\b(curl|wget)\b.*\b100\.100\.100\.200\b/i,
  /\b(curl|wget)\b.*\bfd00::1\b/i, // Azure IMDS IPv6
];

// Sandbox execution limits
export const SANDBOX_LIMITS = {
  maxExecutionTime: 60 * 60 * 1000,
  maxOutputSize: 100 * 1024 * 1024,
  maxConcurrentJobs: 10,
  maxJobDuration: 6 * 60 * 60 * 1000,
  maxStepsPerJob: 1000,
  maxEnvValueLength: 1024 * 1024,
};

export const MAX_CONCURRENT_EXEC_PER_WORKSPACE = 5;

export const REPOS_BASE_DIR = "/repos";
export const WORKDIR_BASE_DIR = os.tmpdir();

// Tool execution constants (shared between routes/runtime/tools.ts and tool-worker.ts)
export const TOOL_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
export const DEFAULT_TIMEOUT_MS = 30_000;
export const MAX_TIMEOUT_MS = 60_000;

// Rate limiting
export const RATE_LIMIT_WINDOW_MS = 60_000;
export const RATE_LIMIT_EXEC_MAX = 60;
export const RATE_LIMIT_SESSION_MAX = 30;
export const RATE_LIMIT_SNAPSHOT_MAX = 10;
export const RATE_LIMIT_ACTIONS_MAX = 30;
export const RATE_LIMIT_GIT_MAX = 30;
export const RATE_LIMIT_REPOS_MAX = 60;
export const RATE_LIMIT_CLI_PROXY_MAX = 60;

// Session management
export const SESSION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;
export const SESSION_MAX_DURATION_MS = 60 * 60 * 1000;
export const SESSION_CLEANUP_INTERVAL_MS = 30 * 1000;
export const MAX_SESSIONS_PER_WORKSPACE = 2;
export const MAX_TOTAL_SESSIONS = 100_000;
export const HEARTBEAT_ASSUMED_INTERVAL_MS = 2 * 60 * 1000;
