/**
 * サービス間認証で利用する JWT ユーティリティ
 * 署名方式は RS256（RSA + SHA-256）を使用する。
 */

import * as crypto from 'node:crypto';
import { Buffer } from "node:buffer";

/**
 * サービストークンの JWT ペイロード構造
 */
export interface ServiceTokenPayload {
  iss: string;  // 発行元サービス名
  sub: string;  // サブジェクト（サービス名またはユーザーID）
  aud: string;  // 対象サービス（audience）
  exp: number;  // 有効期限タイムスタンプ
  iat: number;  // 発行時刻
  jti: string;  // トークンの一意 ID
}

/**
 * カスタムクレームを含める拡張ペイロード
 */
export interface ServiceTokenPayloadWithClaims extends ServiceTokenPayload {
  [key: string]: unknown;
}

/**
 * サービストークン検証オプション
 */
export interface VerifyServiceTokenOptions {
  /** JWT トークン文字列 */
  token: string;
  /** PEM 形式の公開鍵（既定値／フォールバックとして使用） */
  publicKey: string;
  /** ローテーション用公開鍵（kid をキーにしたマップ） */
  publicKeys?: Record<string, string>;
  /** 期待する audience（必須） */
  expectedAudience: string;
  /** 期待する issuer（必須） */
  expectedIssuer: string;
  /** exp/iat 検証時のクロック許容誤差（秒、既定 30） */
  clockToleranceSeconds?: number;
}

/**
 * トークン検証結果
 */
export interface VerifyServiceTokenResult {
  valid: boolean;
  payload?: ServiceTokenPayloadWithClaims;
  error?: string;
}

function base64UrlDecode(str: string): Buffer {
  // パディングを戻す
  let padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const padding = (4 - (padded.length % 4)) % 4;
  padded += '='.repeat(padding);
  const buf = Buffer.from(padded, 'base64');
  if (buf.length === 0 && str.length > 0) {
    throw new Error('Invalid base64url encoding');
  }
  return buf;
}

/**
 * RS256 でサービストークンを検証する
 *
 * @param options - トークンと公開鍵を含む検証オプション
 * @returns 有効な場合は payload を含む検証結果
 */
export function verifyServiceToken(options: VerifyServiceTokenOptions): VerifyServiceTokenResult {
  const {
    token,
    publicKey,
    publicKeys = {},
    expectedAudience,
    expectedIssuer,
    clockToleranceSeconds = 30,
  } = options;

  try {
    // トークンを分割
    const parts = token.split('.');
    if (parts.length !== 3) {
      return { valid: false, error: 'Invalid token format' };
    }

    const [encodedHeader, encodedPayload, encodedSignature] = parts;

    // ヘッダをデコード
    let header: { alg?: string; typ?: string; kid?: string };
    try {
      header = JSON.parse(base64UrlDecode(encodedHeader).toString('utf-8'));
    } catch {
      return { valid: false, error: 'Invalid header encoding' };
    }

    // 署名アルゴリズムを検証
    if (header.alg !== 'RS256') {
      return { valid: false, error: `Unsupported algorithm: ${header.alg}` };
    }

    // kid の有無で検証に使う公開鍵を決定する。
    // kid がある場合は一致する鍵のみを使う（ローテーション厳密運用）。
    // kid がない場合は既定の公開鍵（最新）だけを使い、古い鍵での検証は拒否する。
    const keysToTry: string[] = [];
    if (header.kid) {
      if (publicKeys[header.kid]) {
        // kid があり、対応する鍵が見つかったのでこの鍵のみを使用
        keysToTry.push(publicKeys[header.kid]);
      } else {
        // kid はあるが未登録の鍵 ID のため、直ちに拒否
        return { valid: false, error: `Unknown key ID: ${header.kid}` };
      }
    } else {
      // kid がない場合: 既定（最新）公開鍵のみで検証
      keysToTry.push(publicKey);
    }

    // 署名検証に使用する鍵を順に試行
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = base64UrlDecode(encodedSignature);

    let isValidSignature = false;
    for (const key of keysToTry) {
      const verify = crypto.createVerify('RSA-SHA256');
      verify.update(signingInput);
      verify.end();

      if (verify.verify(key, signature)) {
        isValidSignature = true;
        break;
      }
    }

    if (!isValidSignature) {
      return { valid: false, error: 'Invalid signature' };
    }

    // ペイロードをデコード
    let payload: ServiceTokenPayloadWithClaims;
    try {
      payload = JSON.parse(base64UrlDecode(encodedPayload).toString('utf-8'));
    } catch {
      return { valid: false, error: 'Invalid payload encoding' };
    }

    // 必須の検証設定を確認
    if (!expectedAudience || !expectedIssuer) {
      return { valid: false, error: 'expectedAudience and expectedIssuer are required' };
    }

    // 必須クレームを検証
    if (typeof payload.iss !== 'string' || payload.iss.length === 0) {
      return { valid: false, error: 'Missing or invalid iss claim' };
    }
    if (typeof payload.aud !== 'string' || payload.aud.length === 0) {
      return { valid: false, error: 'Missing or invalid aud claim' };
    }
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      return { valid: false, error: 'Missing or invalid sub claim' };
    }
    if (typeof payload.jti !== 'string' || payload.jti.length === 0) {
      return { valid: false, error: 'Missing or invalid jti claim' };
    }
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
      return { valid: false, error: 'Missing or invalid exp claim' };
    }
    if (typeof payload.iat !== 'number' || !Number.isFinite(payload.iat)) {
      return { valid: false, error: 'Missing or invalid iat claim' };
    }

    // 有効期限を検証
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp + clockToleranceSeconds < now) {
      return { valid: false, error: 'Token has expired' };
    }

    // 発行時刻（iat）と許容誤差を検証
    if (payload.iat - clockToleranceSeconds > now) {
      return { valid: false, error: 'Token issued in the future' };
    }

    // audience を検証
    if (payload.aud !== expectedAudience) {
      return { valid: false, error: `Invalid audience: expected ${expectedAudience}, got ${payload.aud}` };
    }

    // issuer を検証
    if (payload.iss !== expectedIssuer) {
      return { valid: false, error: `Invalid issuer: expected ${expectedIssuer}, got ${payload.iss}` };
    }

    return { valid: true, payload };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return { valid: false, error: `Verification failed: ${message}` };
  }
}
