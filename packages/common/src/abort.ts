/**
 * Abort Signal 用ユーティリティ
 *
 * Takos の各サービス横断で AbortSignal を扱うための共通ヘルパー。
 */

import { AppError } from "./errors.ts";

/**
 * 指定したシグナルが中断済みなら `AppError` を投げる。
 *
 * @param signal  - チェック対象の AbortSignal（`undefined` の場合は何もしない）。
 * @param context - 呼び出し箇所の短い識別子。デバッグ向けにエラーメッセージへ追記される
 *                  （例: `'langgraph-start'`）。
 */
export function throwIfAborted(
  signal: AbortSignal | undefined,
  context?: string,
): void {
  if (!signal?.aborted) {
    return;
  }

  const reason = signal.reason;
  const message = reason instanceof Error
    ? reason.message
    : typeof reason === "string"
    ? reason
    : "Run aborted";

  throw new AppError(context ? `${message} (${context})` : message);
}
