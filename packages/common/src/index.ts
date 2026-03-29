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
export {
  generateId,
} from './id.js';

// =============================================================================
// バリデーションユーティリリティ
// =============================================================================
export {
  isLocalhost,
  isPrivateIP,
} from './validation.js';

// =============================================================================
// 構造化ロガー
// =============================================================================
export { createLogger, type Logger, type LogLevel } from './logger.js';

// =============================================================================
// Abort Signal ユーティリティ
// =============================================================================
export { throwIfAborted } from './abort.js';

// =============================================================================
// 環境変数パース
// =============================================================================
export {
  parseIntEnv,
  parseIntEnvRequired,
  parseIntValue,
  parseFloatEnv,
  parseFloatValue,
} from './env-parse.js';

// =============================================================================
// エラーハンドリング
// =============================================================================
export {
  // エラーコード
  ErrorCodes,
  type ErrorCode,
  // 基本エラー
  AppError,
  // HTTP エラー
  BadRequestError,
  AuthenticationError,
  PaymentRequiredError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  GoneError,
  PayloadTooLargeError,
  ValidationError,
  RateLimitError,
  InternalError,
  NotImplementedError,
  BadGatewayError,
  ServiceUnavailableError,
  GatewayTimeoutError,
  // ユーティリティ関数
  isAppError,
  normalizeError,
  logError,
  getErrorMessage,
  // 型定義
  type ErrorResponse,
  type ValidationErrorDetail,
} from './errors.js';
