import type { GitRefSummary } from "takos-git-contract";
import {
  configuredRepositoryPath,
  isSafeRepositoryId,
  notImplemented,
  runGit,
  runGitWithDirectorySizeCap,
} from "./git.ts";
import { classifyHost } from "./host-blocklist.ts";
import { textDecoder } from "./response-builders.ts";
import { type CommandOutput, getEnv, removePath } from "./runtime.ts";

// Opt-in escape hatch for tests that need to import / fetch from an
// on-disk bare repository fixture. Production callers must use https://
// or git@ SSH shorthand; this env var is only honored in dev / test.
function devAllowLocalRemoteUrl(): boolean {
  return getEnv("TAKOS_GIT_DEV_ALLOW_LOCAL_REMOTE_URL") === "true";
}

// Default cap on how large an externally-imported / fetched repository may
// grow on disk = 2 GiB. Operators can raise/lower via TAKOS_GIT_MAX_IMPORT_SIZE
// (bytes). The fetch is aborted (fail closed) the moment the bare repo exceeds
// this size, so a hostile or runaway remote cannot exhaust disk via an
// unbounded clone / pack.
const DEFAULT_MAX_IMPORT_SIZE = 2 * 1024 * 1024 * 1024;

function configuredMaxImportSize(): number {
  const raw = getEnv("TAKOS_GIT_MAX_IMPORT_SIZE")?.trim();
  if (!raw) return DEFAULT_MAX_IMPORT_SIZE;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_MAX_IMPORT_SIZE;
  return Math.floor(parsed);
}

export type RemoteUrlValidationError = {
  ok: false;
  status: 400;
  body: { error: string; code: string; repositoryId?: string };
};

/**
 * Validate that `remoteUrl` uses one of the explicitly allowed transports
 * and does not point at a private/loopback/link-local IP.
 *
 * Allowed forms:
 *   - https://<host>/...
 *   - http://localhost[:port]/... or http://127.0.0.1[:port]/...
 *   - git@<host>:<path> SSH shorthand
 *
 * Rejected forms (all return `unsupported_remote_protocol`):
 *   - file://, ext::, git://, ssh:// (full URL scheme)
 *   - http:// to any host other than localhost / 127.0.0.1
 *   - any other scheme or naked filesystem path
 *
 * In addition, the host is rejected as `unsupported_remote_protocol_host`
 * when it is — or, for a DNS hostname, resolves to — a loopback, RFC1918,
 * link-local, multicast, CGNAT, or cloud-metadata address. DNS hostnames are
 * resolved (A + AAAA) and every resolved address is range-checked; a host
 * that does not resolve is rejected (fail closed). See `host-blocklist.ts`
 * for the classification rules and the DNS-rebinding caveat. This is async
 * because of the DNS lookup.
 */
export async function validateRemoteUrl(
  remoteUrl: string,
  repositoryId?: string,
): Promise<{ ok: true } | RemoteUrlValidationError> {
  if (typeof remoteUrl !== "string" || remoteUrl.length === 0) {
    return remoteUrlError(
      "remoteUrl must be a non-empty string",
      "unsupported_remote_protocol",
      repositoryId,
    );
  }
  if (remoteUrl.startsWith("-")) {
    return remoteUrlError(
      "remoteUrl must not start with '-' (option-flag smuggling)",
      "unsupported_remote_protocol",
      repositoryId,
    );
  }
  // Reject embedded control characters defensively.
  if (/[\r\n\0\t]/.test(remoteUrl)) {
    return remoteUrlError(
      "remoteUrl must not contain control characters",
      "unsupported_remote_protocol",
      repositoryId,
    );
  }

  if (remoteUrl.startsWith("https://")) {
    const host = extractHttpHost(remoteUrl);
    if (host === undefined) {
      return remoteUrlError(
        "https remoteUrl has no host",
        "unsupported_remote_protocol",
        repositoryId,
      );
    }
    const hostCheck = await classifyHost(host);
    if (!hostCheck.ok) {
      return remoteUrlError(
        `remoteUrl host is not allowed: ${hostCheck.reason}`,
        "unsupported_remote_protocol_host",
        repositoryId,
      );
    }
    return { ok: true };
  }

  if (remoteUrl.startsWith("http://")) {
    const host = extractHttpHost(remoteUrl);
    if (host === undefined) {
      return remoteUrlError(
        "http remoteUrl has no host",
        "unsupported_remote_protocol",
        repositoryId,
      );
    }
    // Only allow plaintext http:// when host is loopback. Production
    // remotes must use https://.
    if (host !== "localhost" && host !== "127.0.0.1") {
      return remoteUrlError(
        `http remoteUrl is only allowed for localhost / 127.0.0.1, got: ${host}`,
        "unsupported_remote_protocol",
        repositoryId,
      );
    }
    return { ok: true };
  }

  if (isSshShorthand(remoteUrl)) {
    const host = extractSshShorthandHost(remoteUrl);
    if (host === undefined) {
      return remoteUrlError(
        "ssh shorthand remoteUrl has no host",
        "unsupported_remote_protocol",
        repositoryId,
      );
    }
    const hostCheck = await classifyHost(host);
    if (!hostCheck.ok) {
      return remoteUrlError(
        `remoteUrl host is not allowed: ${hostCheck.reason}`,
        "unsupported_remote_protocol_host",
        repositoryId,
      );
    }
    return { ok: true };
  }

  // Dev / test only: accept on-disk fixture paths when explicitly opted in.
  if (devAllowLocalRemoteUrl() && !/^[a-z][a-z0-9+.-]*:/i.test(remoteUrl)) {
    return { ok: true };
  }

  return remoteUrlError(
    "remoteUrl must use https://, http://localhost, http://127.0.0.1, or git@<host>:<path>",
    "unsupported_remote_protocol",
    repositoryId,
  );
}

function remoteUrlError(
  message: string,
  code: string,
  repositoryId?: string,
): RemoteUrlValidationError {
  return {
    ok: false,
    status: 400,
    body: repositoryId === undefined
      ? { error: message, code }
      : { error: message, code, repositoryId },
  };
}

function extractHttpHost(url: string): string | undefined {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function isSshShorthand(url: string): boolean {
  // git@host:path form; reject full `ssh://...` URLs explicitly so
  // callers cannot smuggle path traversal through the SSH scheme parser.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return false;
  return /^[A-Za-z0-9_.-]+@([A-Za-z0-9_.:\[\]-]+):/.test(url);
}

function extractSshShorthandHost(url: string): string | undefined {
  const at = url.indexOf("@");
  if (at < 0) return undefined;
  if (url[at + 1] === "[") {
    const closingBracket = url.indexOf("]", at + 2);
    if (closingBracket === -1) return undefined;
    return url.slice(at + 1, closingBracket + 1).toLowerCase();
  }
  const colon = url.indexOf(":", at + 1);
  if (colon < 0) return undefined;
  return url.slice(at + 1, colon).toLowerCase();
}

export async function importExternalRemoteIntoConfiguredRepository(input: {
  repositoryId: string;
  remoteUrl: string;
  authHeader: string | null;
  requestedDefaultBranch?: string;
  previousRefs: GitRefSummary[];
}): Promise<
  | {
    ok: true;
    refs: GitRefSummary[];
    defaultBranch: string;
    branchCount: number;
    tagCount: number;
    commitCount: number;
    newCommits: number;
    updatedBranches: string[];
    newTags: string[];
  }
  | {
    ok: false;
    body: {
      error: string;
      code: string;
      repositoryId?: string;
    };
    status: 400 | 404 | 409 | 422 | 501;
  }
> {
  const repositoryPath = configuredRepositoryPath(input.repositoryId);
  if (!repositoryPath) {
    return {
      ok: false,
      status: 501,
      body: notImplemented("git_repository_root_not_configured"),
    };
  }
  if (!isSafeRepositoryId(input.repositoryId)) {
    return {
      ok: false,
      status: 400,
      body: {
        error: "repositoryId must be a safe relative bare repository path",
        code: "invalid_git_repository_id",
        repositoryId: input.repositoryId,
      },
    };
  }

  const remoteUrlCheck = await validateRemoteUrl(
    input.remoteUrl,
    input.repositoryId,
  );
  if (!remoteUrlCheck.ok) return remoteUrlCheck;

  const commitCountBefore = await countConfiguredRepositoryCommits(
    repositoryPath,
  );
  const maxImportSize = configuredMaxImportSize();
  const { output: fetch, exceededSizeCap } = await runGitWithDirectorySizeCap(
    [
      "--git-dir",
      repositoryPath,
      ...gitAuthConfigArgs(input.authHeader),
      "fetch",
      "--prune",
      "--no-recurse-submodules",
      input.remoteUrl,
      "+refs/heads/*:refs/heads/*",
      "+refs/tags/*:refs/tags/*",
    ],
    repositoryPath,
    maxImportSize,
  );
  if (exceededSizeCap) {
    // The size-cap SIGTERM leaves the aborted pack as unreachable objects in the
    // bare repo (refs were not advanced). Reclaim them best-effort so repeated
    // over-cap attempts cannot accumulate partial packs on disk. Committed
    // objects/refs are reachable and untouched. On the initial-import path the
    // caller additionally removes the whole repo dir, so this is a no-op there.
    try {
      await runGit([
        "--git-dir",
        repositoryPath,
        "gc",
        "--prune=now",
        "--quiet",
      ]);
    } catch {
      // best-effort; the next successful fetch / git auto-gc reclaims the rest
    }
    return {
      ok: false,
      status: 422,
      body: {
        error:
          `external repository exceeds TAKOS_GIT_MAX_IMPORT_SIZE (${maxImportSize} bytes)`,
        code: "git_external_import_too_large",
        repositoryId: input.repositoryId,
      },
    };
  }
  if (!fetch.success) {
    return {
      ok: false,
      status: 422,
      body: {
        error: gitCommandError("failed to fetch external repository", fetch),
        code: "git_external_fetch_failed",
        repositoryId: input.repositoryId,
      },
    };
  }

  const refs = await readGitRefsFromRepositoryPath(
    input.repositoryId,
    repositoryPath,
  );

  const branchRefs = refs.filter((ref) => ref.name.startsWith("refs/heads/"));
  if (branchRefs.length === 0) {
    return {
      ok: false,
      status: 422,
      body: {
        error: "external repository has no branches",
        code: "git_external_repository_empty",
        repositoryId: input.repositoryId,
      },
    };
  }

  const tagRefs = refs.filter((ref) =>
    ref.name.startsWith("refs/tags/") && !ref.name.includes("^{}")
  );
  const remoteHead = await readRemoteHeadBranch(
    input.remoteUrl,
    input.authHeader,
  );
  const defaultBranch = chooseDefaultBranch(
    branchRefs,
    input.requestedDefaultBranch,
    remoteHead,
  );
  await runGit([
    "--git-dir",
    repositoryPath,
    "symbolic-ref",
    "HEAD",
    `refs/heads/${defaultBranch}`,
  ]);

  const previousByName = new Map(
    input.previousRefs.map((ref) => [ref.name, ref.target]),
  );
  const updatedBranches = branchRefs
    .filter((ref) => previousByName.get(ref.name) !== ref.target)
    .map((ref) => ref.name.slice("refs/heads/".length));
  const newTags = tagRefs
    .filter((ref) => !previousByName.has(ref.name))
    .map((ref) => ref.name.slice("refs/tags/".length));
  const commitCount = await countConfiguredRepositoryCommits(repositoryPath);
  const newCommits = Math.max(0, commitCount - commitCountBefore);

  return {
    ok: true,
    refs,
    defaultBranch,
    branchCount: branchRefs.length,
    tagCount: tagRefs.length,
    commitCount,
    newCommits,
    updatedBranches,
    newTags,
  };
}

function gitAuthConfigArgs(authHeader: string | null): string[] {
  // Always prepend protocol-allowlist hardening so that even an empty
  // authHeader caller gets the same protections. These -c flags disable
  // git's `ext::` transport helper, generic transport-helper resolution,
  // and (for the `file` scheme) prevent submodule-style indirection from
  // following file:// pointers that we have not explicitly chosen. We
  // keep `file` at `user` rather than `never` so that test fixtures can
  // still operate when TAKOS_GIT_DEV_ALLOW_LOCAL_REMOTE_URL is set.
  const protocolGuards = [
    "-c",
    "protocol.ext.allow=never",
    "-c",
    "protocol.transport-helper.allow=never",
    "-c",
    "protocol.file.allow=user",
  ];
  // Defense in depth: callers should reject control chars via
  // validateExternalImportRequest / validateExternalFetchRequest, but
  // strip CR / LF / NUL again here so a malformed value cannot inject
  // additional HTTP headers via git's `http.extraHeader` mechanism.
  const trimmed = authHeader?.trim();
  if (!trimmed) return protocolGuards;
  const sanitized = trimmed.replace(/[\r\n\0]/g, "");
  if (!sanitized) return protocolGuards;
  return [
    ...protocolGuards,
    "-c",
    `http.extraHeader=Authorization: ${sanitized}`,
  ];
}

async function readRemoteHeadBranch(
  remoteUrl: string,
  authHeader: string | null,
): Promise<string | undefined> {
  const output = await runGit([
    ...gitAuthConfigArgs(authHeader),
    "ls-remote",
    "--symref",
    remoteUrl,
    "HEAD",
  ]);
  if (!output.success) return undefined;
  for (const line of textDecoder.decode(output.stdout).split("\n")) {
    const match = /^ref:\s+refs\/heads\/([^\t ]+)\s+HEAD$/.exec(line.trim());
    if (match?.[1]) return match[1];
  }
}

function chooseDefaultBranch(
  branchRefs: GitRefSummary[],
  requestedDefaultBranch?: string,
  remoteHead?: string,
): string {
  const branchNames = branchRefs.map((ref) =>
    ref.name.slice(
      "refs/heads/".length,
    )
  );
  if (requestedDefaultBranch && branchNames.includes(requestedDefaultBranch)) {
    return requestedDefaultBranch;
  }
  if (remoteHead && branchNames.includes(remoteHead)) return remoteHead;
  if (branchNames.includes("main")) return "main";
  if (branchNames.includes("master")) return "master";
  return branchNames[0]!;
}

async function countConfiguredRepositoryCommits(
  repositoryPath: string,
): Promise<number> {
  const output = await runGit([
    "--git-dir",
    repositoryPath,
    "rev-list",
    "--all",
    "--count",
  ]);
  if (!output.success) return 0;
  return Number(textDecoder.decode(output.stdout).trim()) || 0;
}

async function readGitRefsFromRepositoryPath(
  repositoryId: string,
  repositoryPath: string,
): Promise<GitRefSummary[]> {
  const output = await runGit([
    "--git-dir",
    repositoryPath,
    "for-each-ref",
    "--format=%(refname)%00%(objectname)",
  ]);
  if (!output.success) throw new Error(`repository not found: ${repositoryId}`);
  return textDecoder.decode(output.stdout).trimEnd().split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name, target] = line.split("\0");
      return { name, target };
    });
}

function gitCommandError(prefix: string, output: CommandOutput): string {
  const stderr = textDecoder.decode(output.stderr).trim();
  return stderr ? `${prefix}: ${stderr.slice(0, 200)}` : prefix;
}

export async function removeConfiguredRepositoryDirectory(
  repositoryId: string,
): Promise<void> {
  const repositoryPath = configuredRepositoryPath(repositoryId);
  if (!repositoryPath) return;
  await removePath(repositoryPath, { recursive: true }).catch(() => {});
}
