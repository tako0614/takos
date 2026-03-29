/**
 * Naming utilities for generating URL-safe identifiers.
 *
 * These helpers enforce consistent naming conventions across the platform:
 *
 * - **slugifyName** — produces compact, URL-safe slugs for spaces and similar
 *   entities.  Strips non-alphanumeric characters, collapses runs into single
 *   hyphens, trims leading/trailing hyphens, and caps the result at
 *   {@link MAX_SLUG_LENGTH} characters.  Returns `"space"` as a fallback when
 *   the input reduces to an empty string.
 *
 * - **sanitizeRepoName** — normalises a user-supplied repository name for
 *   storage.  Trims whitespace, lowercases, and replaces characters outside the
 *   `[a-z0-9_-]` set with hyphens.  Unlike {@link slugifyName}, it preserves
 *   underscores, does not collapse consecutive hyphens, and has no length cap —
 *   callers are expected to enforce length limits at the validation layer.
 */
/**
 * Convert a display name into a URL-safe slug.
 *
 * Rules applied (in order):
 * 1. Lowercase the entire string.
 * 2. Replace every run of non-`[a-z0-9]` characters with a single hyphen.
 * 3. Strip leading and trailing hyphens.
 * 4. Truncate to {@link MAX_SLUG_LENGTH} (32) characters.
 * 5. If the result is empty, return the fallback `"space"`.
 *
 * @param name - The human-readable name to slugify.
 * @returns A lowercase, hyphen-separated slug of at most 32 characters.
 *
 * @example
 * slugifyName('My Space Name')      // "my-space-name"
 * slugifyName('Hello@World! #2024') // "hello-world-2024"
 * slugifyName('')                   // "space"
 */
export declare function slugifyName(name: string): string;
/**
 * Sanitise a user-supplied repository name for safe storage and display.
 *
 * Rules applied (in order):
 * 1. Trim leading/trailing whitespace.
 * 2. Lowercase the entire string.
 * 3. Replace every character outside `[a-z0-9_-]` with a hyphen.
 *
 * Unlike {@link slugifyName}, this function:
 * - Preserves underscores (`_`).
 * - Does **not** collapse consecutive hyphens (e.g. `"@@@@"` → `"----"`).
 * - Does **not** enforce a maximum length — callers should validate length
 *   separately.
 *
 * @param name - The raw repository name entered by the user.
 * @returns A lowercased string containing only `[a-z0-9_-]` characters.
 *
 * @example
 * sanitizeRepoName('  MyRepo  ')    // "myrepo"
 * sanitizeRepoName('my repo@name')  // "my-repo-name"
 * sanitizeRepoName('my_repo-name')  // "my_repo-name"
 */
export declare function sanitizeRepoName(name: string): string;
//# sourceMappingURL=naming-utils.d.ts.map