/**
 * Environment variable parsing helpers.
 *
 * Provides a consistent pattern across all services:
 *  - **Required** vars (`parseIntEnvRequired`): throw if missing or invalid.
 *  - **Optional** vars (`parseIntEnv`, `parseFloatEnv`): log a warning when the
 *    raw value is present but invalid, then fall back to the default.
 *
 * The helpers intentionally avoid importing a specific logger so they stay
 * dependency-free.  A `warnFn` callback is accepted for warning output;
 * callers can wire it to their own logger or leave it as `console.warn`.
 */
type WarnFn = (message: string) => void;
/**
 * Parse an optional integer environment variable.
 *
 * - Missing / empty value -> returns `defaultValue`.
 * - Present but not a valid integer -> logs a warning, returns `defaultValue`.
 * - `min` / `max` constraints are enforced when provided.
 */
export declare function parseIntEnv(name: string, defaultValue: number, options?: {
    min?: number;
    max?: number;
    warn?: WarnFn;
}): number;
/**
 * Parse a required integer environment variable.
 *
 * - Missing / empty -> throws.
 * - Present but not a valid integer -> throws.
 */
export declare function parseIntEnvRequired(name: string, options?: {
    min?: number;
    max?: number;
}): number;
/**
 * Parse an integer from a raw string value (not directly from process.env).
 *
 * Useful when the env value has already been read (e.g. from a Cloudflare
 * Workers `Env` binding) rather than from `process.env`.
 *
 * - `undefined` / empty -> returns `defaultValue`.
 * - Present but not a valid integer -> logs a warning, returns `defaultValue`.
 */
export declare function parseIntValue(name: string, raw: string | undefined, defaultValue: number, options?: {
    min?: number;
    max?: number;
    warn?: WarnFn;
}): number;
/**
 * Parse an optional float environment variable.
 *
 * - Missing / empty value -> returns `defaultValue`.
 * - Present but not a valid number -> logs a warning, returns `defaultValue`.
 * - `min` / `max` constraints are enforced when provided.
 */
export declare function parseFloatEnv(name: string, defaultValue: number, options?: {
    min?: number;
    max?: number;
    warn?: WarnFn;
}): number;
/**
 * Parse a float from a raw string value (not directly from process.env).
 *
 * - `undefined` / empty -> returns `defaultValue`.
 * - Present but not a valid number -> logs a warning, returns `defaultValue`.
 */
export declare function parseFloatValue(name: string, raw: string | undefined, defaultValue: number, options?: {
    min?: number;
    max?: number;
    warn?: WarnFn;
}): number;
export {};
//# sourceMappingURL=env-parse.d.ts.map