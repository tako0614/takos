/**
 * @takos/worker-platform-utils - takos-worker service-local utility exports
 *
 * このパッケージは takos-worker 内で利用するユーティリティを提供する。
 * - ID 生成（generateId）
 * - バリデーションヘルパー（isLocalhost, isPrivateIP）
 * - エラー処理（AppError, ValidationError など）
 * - 構造化ロガー（createLogger）
 * - Hono ミドルウェア
 */

// =============================================================================
// ID 生成ユーティリティ
// =============================================================================
export { generateId } from "./id.ts";

// =============================================================================
// バリデーションユーティリリティ
// =============================================================================
export { isLocalhost, isPrivateIP } from "./validation.ts";
export { resolveContainerHostBaseUrl } from "./container-host.ts";

// =============================================================================
// 構造化ロガー
// =============================================================================
export { createLogger, type Logger, type LogLevel } from "./logger.ts";

// =============================================================================
// Abort Signal ユーティリティ
// =============================================================================
export { combineSignals, throwIfAborted } from "./abort.ts";

// =============================================================================
// Clock (injectable time source for deterministic testing)
// =============================================================================
export { type Clock, fixedClock, manualClock, systemClock } from "./clock.ts";

// =============================================================================
// TTL 型 (branded)
// =============================================================================
export {
  toMs,
  toSeconds,
  type TtlMs,
  ttlMs,
  type TtlSeconds,
  ttlSeconds,
} from "./ttl.ts";

// =============================================================================
// 環境変数パース
// =============================================================================
export {
  parseBoolean,
  parseFloatEnv,
  parseFloatValue,
  parseInteger,
  parseIntEnv,
  parseIntEnvRequired,
  parseIntValue,
  parsePort,
} from "./env-parse.ts";
export {
  currentWorkingDirectory,
  deleteEnv,
  envObject,
  exitProcess,
  getEnv,
  processArgs,
  processId,
  setEnv,
} from "./runtime-env.ts";

// =============================================================================
// エラーハンドリング
// =============================================================================
export {
  // 基本エラー
  AppError,
  AuthenticationError,
  AuthorizationError,
  BadGatewayError,
  // HTTP エラー
  BadRequestError,
  ConflictError,
  type ErrorCode,
  // エラーコード
  ErrorCodes,
  // 型定義
  type ErrorResponse,
  GatewayTimeoutError,
  getErrorMessage,
  GoneError,
  InternalError,
  // ユーティリティ関数
  isAppError,
  logError,
  normalizeError,
  NotFoundError,
  NotImplementedError,
  PayloadTooLargeError,
  PaymentRequiredError,
  RateLimitError,
  ServiceUnavailableError,
  ValidationError,
  type ValidationErrorDetail,
} from "./errors.ts";
