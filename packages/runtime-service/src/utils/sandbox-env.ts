const CORE_SAFE_ENV: Set<string> = new Set([
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
  "COLORTERM",
  "FORCE_COLOR",
  "NO_COLOR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "NODE_ENV",
  "NODE_VERSION",
  "NPM_CONFIG_REGISTRY",
  "CI",
  "EDITOR",
  "VISUAL",
  "PAGER",
]);

const GIT_ENV: Set<string> = new Set([
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_TERMINAL_PROMPT",
]);

const CI_ENV: Set<string> = new Set([
  "RUNNER_TEMP",
  "RUNNER_TOOL_CACHE",
  "PNPM_HOME",
  "YARN_CACHE_FOLDER",
  "npm_config_cache",
]);

const DEFAULT_ACTIONS_ENV_ALLOWLIST: Set<string> = new Set([
  "TAKOS_API_URL",
  "TAKOS_TOKEN",
  "TAKOS_SPACE_ID",
  "TAKOS_REPO_ID",
  "TAKOS_SESSION_ID",
]);

const SENSITIVE_PATTERNS: RegExp[] = [
  // Exact-match service tokens
  /^SERVICE_TOKEN$/i,
  // Prefix-based: cloud, DB, crypto, internal
  /^(R2|S3|JWT|TAKOS|AWS|AZURE|GCP|GOOGLE|CLOUDFLARE|DATABASE|DB|POSTGRES|MYSQL|MONGO|REDIS|SSL|TLS|SSH|PGP|GPG)_/i,
  // Keyword-based: secrets, auth, crypto
  /SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|AUTH|ENCRYPTION|SIGNING|CERTIFICATE/i,
  // Positional matches
  /^API_KEY/i,
  /TOKEN$/i,
];

export const BLOCKED_ENV: Set<string> = new Set([
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_SECURITY_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "AZURE_STORAGE_KEY",
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET",
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "SERVICE_TOKEN",
  "JWT_PUBLIC_KEY",
  "DATABASE_URL",
  "REDIS_URL",
  "SECRET_KEY",
  "PRIVATE_KEY",
  "API_KEY",
  "AUTH_TOKEN",
]);

const VALID_ENV_VAR_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const VALID_ENV_PREFIX_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const MAX_EXEC_ENV_VAR_VALUE_LENGTH = 10 * 1024 * 1024;

function hasControlCharacters(value: string): boolean {
  return value.includes("\0") || value.includes("\r") || value.includes("\n");
}

export type RuntimeExecEnvValidationResult =
  | { ok: true; env: Record<string, string> }
  | { ok: false; error: string };

export function isSensitiveEnvVar(name: string): boolean {
  if (BLOCKED_ENV.has(name)) return true;
  if (CORE_SAFE_ENV.has(name)) return false;
  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(name));
}

export function validateRuntimeExecEnv(
  env: Record<string, string> | undefined,
): RuntimeExecEnvValidationResult {
  if (!env) {
    return { ok: true, env: {} };
  }

  const filteredEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (!VALID_ENV_VAR_NAME_PATTERN.test(key)) {
      return { ok: false, error: `Invalid environment variable name: ${key}` };
    }
    if (isSensitiveEnvVar(key)) {
      return {
        ok: false,
        error: `Sensitive environment variable is not allowed: ${key}`,
      };
    }
    if (value.length > MAX_EXEC_ENV_VAR_VALUE_LENGTH) {
      return {
        ok: false,
        error: `Environment variable value too long: ${key}`,
      };
    }
    if (hasControlCharacters(value)) {
      return {
        ok: false,
        error: `Environment variable contains invalid characters: ${key}`,
      };
    }
    filteredEnv[key] = value;
  }

  return { ok: true, env: filteredEnv };
}

type ProcessEnvRecord = Record<string, string | undefined>;

export function filterSafeEnv(env: ProcessEnvRecord): ProcessEnvRecord {
  const filtered: ProcessEnvRecord = {};
  for (const key of Object.keys(env)) {
    if (CORE_SAFE_ENV.has(key) && !isSensitiveEnvVar(key)) {
      filtered[key] = env[key];
    }
  }
  return filtered;
}

export function readSafeEnv(): ProcessEnvRecord {
  const filtered: ProcessEnvRecord = {};
  for (const key of CORE_SAFE_ENV) {
    const value = Deno.env.get(key);
    if (value !== undefined && !isSensitiveEnvVar(key)) {
      filtered[key] = value;
    }
  }
  return filtered;
}

type ActionsEnvAllowlist = {
  exact: Set<string>;
  prefixes: string[];
};

function readActionsEnvAllowlist(): ActionsEnvAllowlist {
  const exact = new Set(DEFAULT_ACTIONS_ENV_ALLOWLIST);
  const prefixes: string[] = [];
  const configured = Deno.env.get("TAKOS_ACTIONS_ENV_ALLOWLIST") ?? "";

  for (const rawEntry of configured.split(/[,\s]+/)) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    if (entry.endsWith("*")) {
      const prefix = entry.slice(0, -1);
      if (prefix && VALID_ENV_PREFIX_PATTERN.test(prefix)) {
        prefixes.push(prefix);
      }
      continue;
    }

    if (VALID_ENV_VAR_NAME_PATTERN.test(entry)) {
      exact.add(entry);
    }
  }

  return { exact, prefixes };
}

function isActionsEnvAllowed(
  key: string,
  allowlist: ActionsEnvAllowlist,
): boolean {
  if (allowlist.exact.has(key)) return true;
  return allowlist.prefixes.some((prefix) => key.startsWith(prefix));
}

export function createSandboxEnv(
  baseEnv: Record<string, string>,
  maxValueLength: number = 1024 * 1024,
): Record<string, string> {
  const sandboxEnv: Record<string, string> = { CI: "true" };

  const allAllowed = new Set([...CORE_SAFE_ENV, ...GIT_ENV, ...CI_ENV]);
  const actionsEnvAllowlist = readActionsEnvAllowlist();

  for (const key of allAllowed) {
    const value = Deno.env.get(key);
    if (value && !BLOCKED_ENV.has(key)) {
      sandboxEnv[key] = value;
    }
  }

  for (const [key, value] of Object.entries(baseEnv)) {
    if (value.length > maxValueLength) continue;

    // Keep Deno.env inheritance filtered, but trust explicitly provided
    // workflow/job/step env values only when they are part of the documented
    // sandbox allowlist or are explicitly configured.
    const allowConfigured = isActionsEnvAllowed(key, actionsEnvAllowlist);
    if (allAllowed.has(key) || allowConfigured) {
      sandboxEnv[key] = value;
    }
    // Keys not matching any allowlist pattern are silently dropped
  }

  return sandboxEnv;
}
