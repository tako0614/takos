/**
 * 環境変数パース用ヘルパー。
 *
 * すべてのサービスで統一した扱いを提供する:
 *  - **必須** 変数（`parseIntEnvRequired`）: 未設定または不正値なら例外を投げる。
 *  - **任意** 変数（`parseIntEnv` / `parseFloatEnv`）: 値が不正な場合は警告を出して
 *    デフォルト値へフォールバックする。
 *
 * このヘルパーは特定のロガー実装を import しないため依存を持たない。
 * `warnFn` コールバックを受け取り、呼び出し側が任意のロガーへ接続するか
 * `console.warn` を利用できる。
 */

type WarnFn = (message: string) => void;
const defaultWarn: WarnFn = (msg) => console.warn(msg);

// ---------------------------------------------------------------------------
// 整数ヘルパー
// ---------------------------------------------------------------------------

/**
 * 任意の整数型環境変数をパースする。
 *
 * - 値が未設定/空文字なら `defaultValue` を返す。
 * - 値が存在するが整数として不正なら警告ログを出して `defaultValue` を返す。
 * - `min` / `max` 指定があれば境界チェックを行う。
 */
export function parseIntEnv(
  name: string,
  defaultValue: number,
  options?: { min?: number; max?: number; warn?: WarnFn },
): number {
  const raw = (typeof Deno !== 'undefined' ? Deno.env.get(name) : undefined)?.trim();
  if (!raw) return defaultValue;
  return parseIntValue(name, raw, defaultValue, options);
}

/**
 * 必須の整数型環境変数をパースする。
 *
 * - 値が未設定/空文字なら例外を投げる。
 * - 不正な整数値なら例外を投げる。
 */
export function parseIntEnvRequired(
  name: string,
  options?: { min?: number; max?: number },
): number {
  const raw = (typeof Deno !== 'undefined' ? Deno.env.get(name) : undefined)?.trim();
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
 * `Deno.env` から直接読むのではなく、文字列入力から整数をパースする。
 *
 * 例えば Cloudflare Workers の `Env` バインディングなど、
 * 既に文字列として読み込まれた環境値を扱う場合に利用する。
 *
 * - `undefined` / 空文字なら `defaultValue` を返す。
 * - 値が存在するが整数として不正なら警告を出して `defaultValue` を返す。
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
// 小数ヘルパー
// ---------------------------------------------------------------------------

/**
 * 任意の浮動小数点数型環境変数をパースする。
 *
 * - 値が未設定/空文字なら `defaultValue` を返す。
 * - 値が存在するが数値として不正なら警告を出して `defaultValue` を返す。
 * - `min` / `max` 指定があれば境界チェックを行う。
 */
export function parseFloatEnv(
  name: string,
  defaultValue: number,
  options?: { min?: number; max?: number; warn?: WarnFn },
): number {
  const raw = (typeof Deno !== 'undefined' ? Deno.env.get(name) : undefined)?.trim();
  if (!raw) return defaultValue;
  return parseFloatValue(name, raw, defaultValue, options);
}

/**
 * `Deno.env` から直接読むのではなく、文字列入力から浮動小数点数をパースする。
 *
 * - `undefined` / 空文字なら `defaultValue` を返す。
 * - 値が存在するが数値として不正なら警告を出して `defaultValue` を返す。
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
