/**
 * Takos プラットフォーム向けの統一エラー処理
 *
 * 本モジュールはすべての takos パッケージで一貫したエラー処理方針を提供する。
 * すべてのエラーは AppError を継承し、次の項目を持つ。
 * - code: クライアント側ハンドリング用の一意なエラーコード
 * - message: 内部情報を含まないユーザー向け安全メッセージ
 * - statusCode: 返却する HTTP ステータスコード
 * - details: 任意の追加情報（フィールド単位の詳細など）
 */

import type { Logger } from './logger.ts';

/**
 * クライアント側の取り扱いを統一する標準エラーコード
 */
export const ErrorCodes = {
  // 4xx クライアントエラー
  BAD_REQUEST: 'BAD_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  PAYMENT_REQUIRED: 'PAYMENT_REQUIRED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  GONE: 'GONE',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',

  // 5xx サーバーエラー
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  BAD_GATEWAY: 'BAD_GATEWAY',
  GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT',

} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * API レスポンス共通のエラーフォーマット
 */
export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

/**
 * フィールド単位のバリデーションエラー詳細
 */
export interface ValidationErrorDetail {
  field: string;
  message: string;
  value?: unknown;
}

/**
 * アプリケーション基本エラークラス
 * カスタムエラーはすべてこのクラスを継承すること
 */
export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly statusCode: number;
  public readonly details?: unknown;
  constructor(
    message: string,
    code: ErrorCode = ErrorCodes.INTERNAL_ERROR,
    statusCode = 500,
    details?: unknown
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    // エラー発生位置のスタックトレースを正しく保持する
    Error.captureStackTrace?.(this, this.constructor);
  }

  /**
   * エラーを API レスポンス形式に変換する。
   * クライアントへ内部情報が漏れないようにする。
   */
  toResponse(): ErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details !== undefined && { details: this.details }),
      },
    };
  }
}

/**
 * 400 不正なリクエスト
 */
export class BadRequestError extends AppError {
  constructor(message = 'Bad request', details?: unknown) {
    super(message, ErrorCodes.BAD_REQUEST, 400, details);
  }
}

/**
 * 401 認証が必要
 */
export class AuthenticationError extends AppError {
  constructor(message = 'Authentication required', details?: unknown) {
    super(message, ErrorCodes.UNAUTHORIZED, 401, details);
  }
}

/**
 * 402 決済必要
 */
export class PaymentRequiredError extends AppError {
  constructor(message = 'Payment required', details?: unknown) {
    super(message, ErrorCodes.PAYMENT_REQUIRED, 402, details);
  }
}

/**
 * 403 権限不足
 */
export class AuthorizationError extends AppError {
  constructor(message = 'Access denied', details?: unknown) {
    super(message, ErrorCodes.FORBIDDEN, 403, details);
  }
}

/**
 * 404 リソース未検出
 */
export class NotFoundError extends AppError {
  constructor(resource = 'Resource', details?: unknown) {
    super(`${resource} not found`, ErrorCodes.NOT_FOUND, 404, details);
  }
}

/**
 * 409 競合
 */
export class ConflictError extends AppError {
  constructor(message = 'Resource conflict', details?: unknown) {
    super(message, ErrorCodes.CONFLICT, 409, details);
  }
}

/**
 * 410 リソース消失
 */
export class GoneError extends AppError {
  constructor(message = 'Resource is no longer available', details?: unknown) {
    super(message, ErrorCodes.GONE, 410, details);
  }
}

/**
 * 413 ボディが上限を超過
 */
export class PayloadTooLargeError extends AppError {
  constructor(message = 'Payload too large', details?: unknown) {
    super(message, ErrorCodes.PAYLOAD_TOO_LARGE, 413, details);
  }
}

/**
 * 422 バリデーション失敗
 */
export class ValidationError extends AppError {
  public readonly fieldErrors: ValidationErrorDetail[];

  constructor(
    message = 'Validation failed',
    fieldErrors: ValidationErrorDetail[] = []
  ) {
    super(
      message,
      ErrorCodes.VALIDATION_ERROR,
      422,
      fieldErrors.length > 0 ? { fields: fieldErrors } : undefined
    );
    this.fieldErrors = fieldErrors;
  }
}

/**
 * 429 リクエスト過多
 */
export class RateLimitError extends AppError {
  public readonly retryAfter?: number;

  constructor(message = 'Rate limit exceeded', retryAfter?: number) {
    super(message, ErrorCodes.RATE_LIMITED, 429);
    this.retryAfter = retryAfter;
  }
}

/**
 * 500 サーバー内部エラー
 */
export class InternalError extends AppError {
  constructor(message = 'Internal server error', details?: unknown) {
    super(message, ErrorCodes.INTERNAL_ERROR, 500, details);
  }
}

/**
 * 501 未実装
 */
export class NotImplementedError extends AppError {
  constructor(message = 'Not implemented', details?: unknown) {
    super(message, ErrorCodes.NOT_IMPLEMENTED, 501, details);
  }
}

/**
 * 502 不正なゲートウェイ応答
 */
export class BadGatewayError extends AppError {
  constructor(message = 'Bad gateway', details?: unknown) {
    super(message, ErrorCodes.BAD_GATEWAY, 502, details);
  }
}

/**
 * 503 サービス利用不可（または一時停止）
 */
export class ServiceUnavailableError extends AppError {
  constructor(message = 'Service temporarily unavailable', details?: unknown) {
    super(message, ErrorCodes.SERVICE_UNAVAILABLE, 503, details);
  }
}

/**
 * 504 上流タイムアウト
 */
export class GatewayTimeoutError extends AppError {
  constructor(message = 'Gateway timeout', details?: unknown) {
    super(message, ErrorCodes.GATEWAY_TIMEOUT, 504, details);
  }
}

/**
 * エラーが AppError かを判定する型ガード
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/**
 * 不明なエラーを AppError に変換する。
 * レスポンス送信前のエラー正規化に利用する。
 */
export function normalizeError(error: unknown, logger?: Logger): AppError {
  if (isAppError(error)) {
    return error;
  }

  if (error instanceof Error) {
    if (logger) {
      logger.error('Converting Error to AppError', { error });
    } else {
      console.error('[normalizeError] Converting Error to AppError:', error);
    }
    return new InternalError('An unexpected error occurred');
  }

  if (logger) {
    logger.error('Converting unknown to AppError', { value: String(error) });
  } else {
    console.error('[normalizeError] Converting unknown to AppError:', error);
  }
  return new InternalError('An unexpected error occurred');
}

/**
 * 不明な例外値から、人間向けのメッセージ文字列を取り出す。
 *
 * 引数が 1 つのみの場合は旧 `runtime-service/utils/error-message` の挙動と同じ
 * （非 Error 値は `String(error)` を返す）。`fallback` が指定された場合は、
 * 旧 `control/web/lib/errors` の挙動に合わせて、意味のある文字列が取れない場合に
 * その fallback を返す。
 */
export function getErrorMessage(error: unknown, fallback?: string): string {
  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null) {
    const candidate = (error as { message?: unknown }).message;
    if (typeof candidate === 'string' && candidate.trim()) {
      return candidate;
    }
  }

  return fallback !== undefined ? fallback : String(error);
}

/**
 * サーバー側デバッグ向けにエラー情報を詳細付きでログに出す
 */
export function logError(error: unknown, context?: Record<string, unknown>, logger?: Logger): void {
  const errorInfo = isAppError(error)
    ? {
        name: error.name,
        code: error.code,
        message: error.message,
        statusCode: error.statusCode,
        details: error.details,
        stack: error.stack,
      }
    : {
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };

  if (logger) {
    logger.error('Error', { ...errorInfo, ...context });
  } else {
    console.error('[Error]', {
      ...errorInfo,
      context,
      timestamp: new Date().toISOString(),
    });
  }
}
