/**
 * External Import Utilities.
 *
 * URL parsing, name inference, and auth header construction
 * for importing external Git repositories into the store.
 */

/**
 * Parse a Git HTTPS URL into its components.
 *
 * Supports formats:
 *   - https://github.com/owner/repo.git
 *   - https://github.com/owner/repo
 *   - https://gitlab.example.com/group/subgroup/repo.git
 */
export function parseGitUrl(
  url: string,
): { host: string; path: string; owner: string; repo: string } {
  let normalized = url.trim();

  // Remove trailing slashes and .git suffix for parsing
  normalized = normalized.replace(/\/+$/, "");
  const withoutGit = normalized.replace(/\.git$/, "");

  let parsed: URL;
  try {
    parsed = new URL(withoutGit);
  } catch {
    throw new Error(`Invalid Git URL: ${url}`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error(
      `Unsupported protocol: ${parsed.protocol} (only https:// is supported)`,
    );
  }

  const pathParts = parsed.pathname.split("/").filter(Boolean);

  if (pathParts.length < 2) {
    throw new Error(`Git URL must include owner and repository: ${url}`);
  }

  const repo = pathParts[pathParts.length - 1];
  const owner = pathParts.slice(0, -1).join("/");

  return {
    host: parsed.host,
    path: parsed.pathname,
    owner,
    repo,
  };
}

/**
 * Infer a local repository name from a Git URL.
 *
 * Examples:
 *   - `https://github.com/owner/my-repo.git` → `my-repo`
 *   - `https://gitlab.com/group/sub/project` → `project`
 */
export function inferRepoName(url: string): string {
  const { repo } = parseGitUrl(url);
  return repo;
}

/**
 * Normalize a Git URL to ensure it ends with `.git`.
 *
 * Many servers accept both `/repo` and `/repo.git` but the smart HTTP
 * protocol endpoints (`/info/refs`, `/git-upload-pack`) are typically
 * mounted under the `.git` suffix.
 */
export function normalizeGitUrl(url: string): string {
  let normalized = url.trim().replace(/\/+$/, "");
  if (!normalized.endsWith(".git")) {
    normalized += ".git";
  }
  return normalized;
}

/**
 * Build an HTTP Basic auth header.
 */
export function buildBasicAuthHeader(
  username: string,
  password: string,
): string {
  const encoded = btoa(`${username}:${password}`);
  return `Basic ${encoded}`;
}

/**
 * Build a Bearer auth header (for PAT or OAuth tokens).
 */
export function buildBearerAuthHeader(token: string): string {
  return `Bearer ${token}`;
}

/**
 * Build an auth header from flexible input options.
 * Returns null if no credentials are provided.
 */
export function buildAuthHeader(auth?: {
  token?: string;
  username?: string;
  password?: string;
}): string | null {
  if (!auth) return null;

  if (auth.token) {
    return buildBearerAuthHeader(auth.token);
  }

  if (auth.username && auth.password) {
    return buildBasicAuthHeader(auth.username, auth.password);
  }

  return null;
}

/**
 * Sanitize a repository name for local use.
 * Allows alphanumeric, hyphens, underscores, and dots.
 */
export function sanitizeImportName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100);
}
