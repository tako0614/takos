/**
 * Centralized constants for the actions-engine package.
 *
 * All magic numbers and hard-coded limits are defined here so that they are
 * easy to find, document, and tune without touching implementation files.
 */

// ---------------------------------------------------------------------------
// Parser limits
// ---------------------------------------------------------------------------

/**
 * Maximum number of `evaluate()` calls allowed per expression evaluation.
 * Guards against runaway recursion or adversarial expressions that attempt to
 * consume unbounded CPU time (e.g. deeply nested bracket accesses).
 */
export const MAX_EVALUATE_CALLS = 10_000;

/**
 * Maximum depth of chained property / bracket accesses (e.g. `a.b.c[0].d`).
 * Prevents stack overflow and excessive object traversal from malicious or
 * accidentally deep expressions.
 */
export const MAX_PARSE_ACCESS_DEPTH = 128;

/**
 * Maximum byte length of a JSON string accepted by the `fromJSON()` expression
 * function. Capped at 1 MB to prevent out-of-memory conditions when an
 * attacker-controlled value is passed to `JSON.parse`.
 */
export const MAX_FROM_JSON_SIZE = 1_048_576; // 1 MB

/**
 * Maximum byte length of an expression (the content inside `${{ }}`).
 * Set to 64 KB, which is well above any reasonable expression while still
 * preventing denial-of-service via extremely long input strings.
 */
export const MAX_EXPRESSION_SIZE = 64 * 1024; // 64 KB

// ---------------------------------------------------------------------------
// Scheduler / step-runner limits
// ---------------------------------------------------------------------------

/**
 * Default step timeout in minutes, used when a step does not specify
 * `timeout-minutes`. Matches the GitHub Actions default of 360 minutes
 * (6 hours).
 */
export const DEFAULT_TIMEOUT_MINUTES = 360;

/**
 * Multiplier to convert minutes to milliseconds for `setTimeout` calls.
 */
export const MINUTES_TO_MS = 60_000;

/**
 * Maximum size in bytes for GITHUB_ENV / GITHUB_OUTPUT / GITHUB_PATH command
 * files written by step scripts. Capped at 10 MB to prevent a single step
 * from exhausting memory when the runner reads these files back.
 */
export const MAX_COMMAND_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
