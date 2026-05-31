/**
 * 環境変数パース用ヘルパー。
 *
 * すべてのサービスで統一した扱いを提供する:
 *  - **必須** 変数（`parseIntEnvRequired`）: 未設定または不正値なら例外を投げる。
 *  - **任意** 変数（`parseIntEnv` / `parseFloatEnv` / `parseBoolean` /
 *    `parseInteger` / `parsePort`）: 値が不正な場合は警告を出して
 *    デフォルト値へフォールバックする。
 *
 * このヘルパーは特定のロガー実装を import しないため依存を持たない。
 * `warnFn` コールバックを受け取り、呼び出し側が任意のロガーへ接続するか
 * `console.warn` を利用できる。
 */
import { getEnv } from "./runtime-env.ts";

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
  const raw = getEnv(name)?.trim();
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
  const raw = getEnv(name)?.trim();
  if (!raw) {
    throw new Error(`Required environment variable ${name} is not set`);
  }
  if (!/^[+-]?\d+$/.test(raw)) {
    throw new Error(`Invalid integer for environment variable ${name}: ${raw}`);
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid integer for environment variable ${name}: ${raw}`);
  }
  if (options?.min != null && parsed < options.min) {
    throw new Error(
      `Environment variable ${name} value ${parsed} is below minimum ${options.min}`,
    );
  }
  if (options?.max != null && parsed > options.max) {
    throw new Error(
      `Environment variable ${name} value ${parsed} exceeds maximum ${options.max}`,
    );
  }
  return parsed;
}

/**
 * runtime env から直接読むのではなく、文字列入力から整数をパースする。
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
  if (!raw || raw.trim() === "") return defaultValue;

  const trimmed = raw.trim();
  if (!/^[+-]?\d+$/.test(trimmed)) {
    warn(
      `Invalid integer for ${name}: "${trimmed}", using default ${defaultValue}`,
    );
    return defaultValue;
  }
  const parsed = Number.parseInt(trimmed, 10);

  if (!Number.isFinite(parsed)) {
    warn(
      `Invalid integer for ${name}: "${trimmed}", using default ${defaultValue}`,
    );
    return defaultValue;
  }
  if (options?.min != null && parsed < options.min) {
    warn(
      `Value for ${name} (${parsed}) is below minimum ${options.min}, using default ${defaultValue}`,
    );
    return defaultValue;
  }
  if (options?.max != null && parsed > options.max) {
    warn(
      `Value for ${name} (${parsed}) exceeds maximum ${options.max}, using default ${defaultValue}`,
    );
    return defaultValue;
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// 統一名 helper (value-only, 文字列入力を受ける)
// ---------------------------------------------------------------------------

const BOOL_TRUE_VALUES = new Set(["true", "1", "yes", "on"]);
const BOOL_FALSE_VALUES = new Set(["false", "0", "no", "off"]);

/**
 * 文字列入力から boolean を解釈する。
 *
 * 受け付ける値 (case-insensitive、前後 whitespace は trim):
 * - true 系: `true`, `1`, `yes`, `on`
 * - false 系: `false`, `0`, `no`, `off`
 *
 * `undefined` / 空文字 / 認識できない値は `defaultValue` を返し、
 * 認識できない場合は警告を出す。
 *
 * @example
 * ```ts
 * parseBoolean("true", false);   // true
 * parseBoolean("YES", false);    // true (case-insensitive)
 * parseBoolean("0", true);       // false
 * parseBoolean(undefined, true); // true (default)
 * parseBoolean("maybe", true);   // true (default, with warning)
 * ```
 */
export function parseBoolean(
  value: string | undefined,
  defaultValue: boolean,
  options?: { warn?: WarnFn; name?: string },
): boolean {
  const warn = options?.warn ?? defaultWarn;
  if (value === undefined) return defaultValue;
  const trimmed = value.trim();
  if (trimmed === "") return defaultValue;
  const lowered = trimmed.toLowerCase();
  if (BOOL_TRUE_VALUES.has(lowered)) return true;
  if (BOOL_FALSE_VALUES.has(lowered)) return false;
  const label = options?.name ? `for ${options.name}` : "for boolean env value";
  warn(
    `Invalid boolean ${label}: "${trimmed}", expected one of [true,1,yes,on,false,0,no,off]; using default ${defaultValue}`,
  );
  return defaultValue;
}

/**
 * 文字列入力から正の整数 (0 以上) を解釈する。
 *
 * `parseIntValue` の薄い alias で、 統一名 (`parseBoolean` / `parseInteger` /
 * `parsePort`) で読みたい呼び出し側用に提供する。
 *
 * - `undefined` / 空文字 → `defaultValue`
 * - NaN / 整数でない / 負の値 → `defaultValue` を返し警告を出す
 *
 * @example
 * ```ts
 * parseInteger("42", 0);       // 42
 * parseInteger("-1", 5);       // 5 (negative -> default, with warning)
 * parseInteger("abc", 10);     // 10 (NaN -> default, with warning)
 * parseInteger(undefined, 7);  // 7
 * ```
 */
export function parseInteger(
  value: string | undefined,
  defaultValue: number,
  options?: { warn?: WarnFn; name?: string },
): number {
  const name = options?.name ?? "integer env value";
  return parseIntValue(name, value, defaultValue, {
    min: 0,
    warn: options?.warn,
  });
}

/**
 * 文字列入力から TCP/UDP port 番号 (1-65535) を解釈する。
 *
 * - `undefined` / 空文字 → `defaultValue`
 * - 範囲外 / NaN / 整数でない → `defaultValue` を返し警告を出す
 *
 * port 0 は OS に任せる意味で valid な選択にもなり得るが、 ここでは
 * configuration mistake (= 未設定で 0 が入る) を弾くため明示的に 1 以上を要求する。
 *
 * @example
 * ```ts
 * parsePort("8080", 80);        // 8080
 * parsePort("0", 80);           // 80 (out of range -> default)
 * parsePort("70000", 443);      // 443 (out of range -> default)
 * parsePort(undefined, 8787);   // 8787
 * ```
 */
export function parsePort(
  value: string | undefined,
  defaultValue: number,
  options?: { warn?: WarnFn; name?: string },
): number {
  const name = options?.name ?? "port env value";
  return parseIntValue(name, value, defaultValue, {
    min: 1,
    max: 65535,
    warn: options?.warn,
  });
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
  const raw = getEnv(name)?.trim();
  if (!raw) return defaultValue;
  return parseFloatValue(name, raw, defaultValue, options);
}

/**
 * runtime env から直接読むのではなく、文字列入力から浮動小数点数をパースする。
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
  if (!raw || raw.trim() === "") return defaultValue;

  const trimmed = raw.trim();
  if (!/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(trimmed)) {
    warn(
      `Invalid number for ${name}: "${trimmed}", using default ${defaultValue}`,
    );
    return defaultValue;
  }
  const parsed = Number.parseFloat(trimmed);

  if (!Number.isFinite(parsed)) {
    warn(
      `Invalid number for ${name}: "${trimmed}", using default ${defaultValue}`,
    );
    return defaultValue;
  }
  if (options?.min != null && parsed < options.min) {
    warn(
      `Value for ${name} (${parsed}) is below minimum ${options.min}, using default ${defaultValue}`,
    );
    return defaultValue;
  }
  if (options?.max != null && parsed > options.max) {
    warn(
      `Value for ${name} (${parsed}) exceeds maximum ${options.max}, using default ${defaultValue}`,
    );
    return defaultValue;
  }
  return parsed;
}
