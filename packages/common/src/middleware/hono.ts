/**
 * takos-runtime 用 Hono ミドルウェア
 *
 * 提供機能:
 * - サービス間 JWT 認証（RS256）
 * - 一貫したエラーハンドリング
 */

import type { Context, Next, Env, ErrorHandler } from 'hono';
import {
  verifyServiceToken,
  type ServiceTokenPayloadWithClaims,
} from '../jwt.js';

export type { ServiceTokenPayloadWithClaims };
import {
  AppError,
  AuthenticationError,
  ErrorCodes,
  InternalError,
  isAppError,
  logError,
  NotFoundError,
  RateLimitError,
  ServiceUnavailableError,
  type ErrorCode,
  type ErrorResponse,
} from '../errors.js';

// =============================================================================
// Hono 用コンテキスト変数の型定義
// =============================================================================

/**
 * サービストークンミドルウェアの環境定義。
 * Hono の型パラメータとして指定することで、コンテキスト変数を型安全に扱える。
 *
 * 使用例:
 * ```typescript
 * import type { ServiceTokenEnv } from 'takos-common/middleware/hono';
 * const app = new Hono<ServiceTokenEnv>();
 * ```
 */
export interface ServiceTokenEnv extends Env {
  Variables: {
    serviceToken: ServiceTokenPayloadWithClaims;
    serviceAuthMethod: 'jwt';
  };
}

// =============================================================================
// サービストークン認証ミドルウェア
// =============================================================================

/**
 * サービストークンミドルウェアの設定
 */
export interface ServiceTokenConfig {
  /** JWT 検証用公開鍵（PEM 形式） */
  jwtPublicKey?: string;
  /** JWT トークンの issuer 想定値（jwtPublicKey を設定する場合は必須） */
  expectedIssuer?: string;
  /** JWT トークンの audience 想定値（jwtPublicKey を設定する場合は必須） */
  expectedAudience?: string;
  /** 認証をスキップするパス（例: health check） */
  skipPaths?: string[];
  /** タイムスタンプ許容誤差（秒、既定: 30） */
  clockToleranceSeconds?: number;
}

/**
 * Authorization ヘッダからサービストークンを取り出す。
 *
 * 補足: `takos/packages/control/src/shared/utils/url-utils.ts` には
 * 生のヘッダ文字列を扱う同等の `extractBearerToken(header: string | null)` があります。
 * こちらの実装では `takos-common` が `control` パッケージを import できないため
 * 分離しているため、ロジック変更時は両方更新すること。
 */
export function getServiceTokenFromHeader(c: Context): string | null {
  const authHeader = c.req.header('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length).trim();
  }
  return null;
}

/**
 * トークンが JWT 形式（`.` で3分割）かどうかを確認する
 */
function isJwtFormat(token: string): boolean {
  const parts = token.split('.');
  return parts.length === 3;
}

/**
 * サービストークン認証の Hono ミドルウェアを生成する。
 * 受け付ける JWT は RS256 のみ。
 *
 * @param config - ミドルウェア設定
 * @returns Hono ミドルウェア関数
 *
 * 使用例:
 * ```typescript
 * import { createServiceTokenMiddleware } from 'takos-common/middleware/hono';
 *
 * const app = new Hono<ServiceTokenEnv>();
 * app.use('*', createServiceTokenMiddleware({ jwtPublicKey: '...' }));
 * ```
 */
export function createServiceTokenMiddleware(config: ServiceTokenConfig) {
  const {
    jwtPublicKey,
    expectedIssuer,
    expectedAudience,
    skipPaths = ['/health'],
    clockToleranceSeconds = 30,
  } = config;

  return async (c: Context, next: Next): Promise<Response | void> => {
    // 特定のパスは認証をスキップ（例: health check）
    const path = new URL(c.req.url).pathname;
    if (skipPaths.includes(path)) {
      await next();
      return;
    }

    if (!jwtPublicKey) {
      const error = new ServiceUnavailableError('Service token not configured');
      return c.json(error.toResponse(), error.statusCode as 503);
    }

    if (!expectedIssuer || !expectedAudience) {
      const error = new ServiceUnavailableError('JWT verification requires expectedIssuer and expectedAudience');
      return c.json(error.toResponse(), error.statusCode as 503);
    }

    // リクエストからトークンを抽出
    const token = getServiceTokenFromHeader(c);
    if (!token) {
      const error = new AuthenticationError('Authorization token is required');
      return c.json(error.toResponse(), error.statusCode as 401);
    }

    if (!isJwtFormat(token)) {
      const error = new AuthenticationError('Service token must be a JWT');
      return c.json(error.toResponse(), error.statusCode as 401);
    }

    const result = verifyServiceToken({
      token,
      publicKey: jwtPublicKey,
      expectedAudience,
      expectedIssuer,
      clockToleranceSeconds,
    });

    if (result.valid && result.payload) {
      c.set('serviceToken', result.payload);
      c.set('serviceAuthMethod', 'jwt' as const);
      await next();
      return;
    }

    const error = new AuthenticationError(result.error || 'Invalid JWT token');
    return c.json(error.toResponse(), error.statusCode as 401);
  };
}

// =============================================================================
// エラーハンドリング
// =============================================================================

/**
 * エラーハンドラの設定
 */
export interface ErrorHandlerOptions {
  /** レスポンスにスタックトレースを含める（開発環境のみ） */
  includeStack?: boolean;
  /** カスタムエラーロガー */
  logger?: (error: unknown, context?: Record<string, unknown>) => void;
  /** カスタムエラー変換関数 */
  transformError?: (error: unknown) => AppError;
}

/**
 * Hono の `app.onError` 用のエラーハンドラを作成する
 *
 * 使用例:
 * ```typescript
 * import { createErrorHandler } from 'takos-common/middleware/hono';
 *
 * const app = new Hono();
 * app.onError(createErrorHandler({ includeStack: true }));
 * ```
 */
export function createErrorHandler(
  options: ErrorHandlerOptions = {}
): ErrorHandler {
  const { includeStack = false, logger = logError, transformError } = options;

  return (err: Error, c: Context) => {
    // 変換関数があればエラーを変換
    let appError: AppError;
    if (transformError) {
      appError = transformError(err);
    } else if (isAppError(err)) {
      appError = err;
    } else {
      // 想定外エラーは詳細をフルログ出力
      const path = new URL(c.req.url).pathname;
      logger(err, {
        path,
        method: c.req.method,
        requestId: c.req.header('x-request-id'),
      });
      appError = new InternalError('An unexpected error occurred');
    }

    // レスポンスボディを構築
    const response = appError.toResponse();

    // 開発時のみスタックトレースを付与
    if (includeStack && appError.stack) {
      (response.error as Record<string, unknown>).stack = appError.stack;
    }

    // レート制限時のレスポンスヘッダを設定
    if (appError instanceof RateLimitError && appError.retryAfter) {
      c.header('Retry-After', String(appError.retryAfter));
    }

    return c.json(response, appError.statusCode as 500);
  };
}

/**
 * Hono 向け 404 ハンドラ
 * `app.notFound()` で利用
 *
 * 使用例:
 * ```typescript
 * import { notFoundHandler } from 'takos-common/middleware/hono';
 *
 * const app = new Hono();
 * app.notFound(notFoundHandler);
 * ```
 */
export function notFoundHandler(c: Context) {
  const error = new NotFoundError('Route');
  return c.json(error.toResponse(), 404);
}

// ============================================================================
// ルートハンドラ用ヘルパー
// ============================================================================

function buildErrorBody(
  message: string,
  code: ErrorCode,
  details?: unknown
): ErrorResponse {
  return {
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
    },
  };
}

/**
 * 400 不正なリクエスト
 */
export function badRequest(
  c: Context,
  message = 'Bad request',
  details?: unknown
) {
  return c.json(buildErrorBody(message, ErrorCodes.BAD_REQUEST, details), 400);
}

/**
 * 404 リソース未検出
 */
export function notFound(
  c: Context,
  message = 'Not found',
  details?: unknown
) {
  return c.json(buildErrorBody(message, ErrorCodes.NOT_FOUND, details), 404);
}

/**
 * 403 アクセス禁止
 */
export function forbidden(c: Context, message = 'Access denied', details?: unknown) {
  return c.json(buildErrorBody(message, ErrorCodes.FORBIDDEN, details), 403);
}

/**
 * 500 サーバー内部エラー
 */
export function internalError(
  c: Context,
  message = 'Internal server error',
  details?: unknown
) {
  return c.json(buildErrorBody(message, ErrorCodes.INTERNAL_ERROR, details), 500);
}
