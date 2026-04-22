/**
 * takos-common - Takos サービス共通ユーティリティ
 *
 * このパッケージは全体で利用する共通ユーティリティを提供する。
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

// =============================================================================
// 構造化ロガー
// =============================================================================
export { createLogger, type Logger, type LogLevel } from "./logger.ts";

// =============================================================================
// Abort Signal ユーティリティ
// =============================================================================
export { throwIfAborted } from "./abort.ts";

// =============================================================================
// 環境変数パース
// =============================================================================
export {
  parseFloatEnv,
  parseFloatValue,
  parseIntEnv,
  parseIntEnvRequired,
  parseIntValue,
} from "./env-parse.ts";

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
