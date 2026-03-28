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
const defaultWarn: WarnFn = (msg) => console.warn(msg);

// ---------------------------------------------------------------------------
// Integer helpers
// ---------------------------------------------------------------------------

/**
 * Parse an optional integer environment variable.
 *
 * - Missing / empty value -> returns `defaultValue`.
 * - Present but not a valid integer -> logs a warning, returns `defaultValue`.
 * - `min` / `max` constraints are enforced when provided.
 */
export function parseIntEnv(
  name: string,
  defaultValue: number,
  options?: { min?: number; max?: number; warn?: WarnFn },
): number {
  const raw = (typeof globalThis.process !== 'undefined' ? process.env[name] : undefined)?.trim();
  if (!raw) return defaultValue;
  return parseIntValue(name, raw, defaultValue, options);
}

/**
 * Parse a required integer environment variable.
 *
 * - Missing / empty -> throws.
 * - Present but not a valid integer -> throws.
 */
export function parseIntEnvRequired(
  name: string,
  options?: { min?: number; max?: number },
): number {
  const raw = (typeof globalThis.process !== 'undefined' ? process.env[name] : undefined)?.trim();
  if (!raw) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer for environment variable ${name}: ${raw}`);
  }
  if (options?.min != null && parsed < options.min) {
    throw new Error(`Environment variable ${name} value ${parsed} is below minimum ${options.min}`);
  }
  if (options?.max != null && parsed > options.max) {
    throw new Error(`Environment variable ${name} value ${parsed} exceeds maximum ${options.max}`);
  }
  return parsed;
}

/**
 * Parse an integer from a raw string value (not directly from process.env).
 *
 * Useful when the env value has already been read (e.g. from a Cloudflare
 * Workers `Env` binding) rather than from `process.env`.
 *
 * - `undefined` / empty -> returns `defaultValue`.
 * - Present but not a valid integer -> logs a warning, returns `defaultValue`.
 */
export function parseIntValue(
  name: string,
  raw: string | undefined,
  defaultValue: number,
  options?: { min?: number; max?: number; warn?: WarnFn },
): number {
  const warn = options?.warn ?? defaultWarn;
  if (!raw || raw.trim() === '') return defaultValue;

  const trimmed = raw.trim();
  const parsed = Number.parseInt(trimmed, 10);

  if (!Number.isFinite(parsed)) {
    warn(`Invalid integer for ${name}: "${trimmed}", using default ${defaultValue}`);
    return defaultValue;
  }
  if (options?.min != null && parsed < options.min) {
    warn(`Value for ${name} (${parsed}) is below minimum ${options.min}, using default ${defaultValue}`);
    return defaultValue;
  }
  if (options?.max != null && parsed > options.max) {
    warn(`Value for ${name} (${parsed}) exceeds maximum ${options.max}, using default ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Float helpers
// ---------------------------------------------------------------------------

/**
 * Parse an optional float environment variable.
 *
 * - Missing / empty value -> returns `defaultValue`.
 * - Present but not a valid number -> logs a warning, returns `defaultValue`.
 * - `min` / `max` constraints are enforced when provided.
 */
export function parseFloatEnv(
  name: string,
  defaultValue: number,
  options?: { min?: number; max?: number; warn?: WarnFn },
): number {
  const raw = (typeof globalThis.process !== 'undefined' ? process.env[name] : undefined)?.trim();
  if (!raw) return defaultValue;
  return parseFloatValue(name, raw, defaultValue, options);
}

/**
 * Parse a float from a raw string value (not directly from process.env).
 *
 * - `undefined` / empty -> returns `defaultValue`.
 * - Present but not a valid number -> logs a warning, returns `defaultValue`.
 */
export function parseFloatValue(
  name: string,
  raw: string | undefined,
  defaultValue: number,
  options?: { min?: number; max?: number; warn?: WarnFn },
): number {
  const warn = options?.warn ?? defaultWarn;
  if (!raw || raw.trim() === '') return defaultValue;

  const trimmed = raw.trim();
  const parsed = Number.parseFloat(trimmed);

  if (!Number.isFinite(parsed)) {
    warn(`Invalid number for ${name}: "${trimmed}", using default ${defaultValue}`);
    return defaultValue;
  }
  if (options?.min != null && parsed < options.min) {
    warn(`Value for ${name} (${parsed}) is below minimum ${options.min}, using default ${defaultValue}`);
    return defaultValue;
  }
  if (options?.max != null && parsed > options.max) {
    warn(`Value for ${name} (${parsed}) exceeds maximum ${options.max}, using default ${defaultValue}`);
    return defaultValue;
  }
  return parsed;
}
