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
export declare function parseGitUrl(url: string): {
    host: string;
    path: string;
    owner: string;
    repo: string;
};
/**
 * Infer a local repository name from a Git URL.
 *
 * Examples:
 *   - `https://github.com/owner/my-repo.git` → `my-repo`
 *   - `https://gitlab.com/group/sub/project` → `project`
 */
export declare function inferRepoName(url: string): string;
/**
 * Normalize a Git URL to ensure it ends with `.git`.
 *
 * Many servers accept both `/repo` and `/repo.git` but the smart HTTP
 * protocol endpoints (`/info/refs`, `/git-upload-pack`) are typically
 * mounted under the `.git` suffix.
 */
export declare function normalizeGitUrl(url: string): string;
/**
 * Build an HTTP Basic auth header.
 */
export declare function buildBasicAuthHeader(username: string, password: string): string;
/**
 * Build a Bearer auth header (for PAT or OAuth tokens).
 */
export declare function buildBearerAuthHeader(token: string): string;
/**
 * Build an auth header from flexible input options.
 * Returns null if no credentials are provided.
 */
export declare function buildAuthHeader(auth?: {
    token?: string;
    username?: string;
    password?: string;
}): string | null;
/**
 * Sanitize a repository name for local use.
 * Allows alphanumeric, hyphens, underscores, and dots.
 */
export declare function sanitizeImportName(name: string): string;
//# sourceMappingURL=external-import-utils.d.ts.map