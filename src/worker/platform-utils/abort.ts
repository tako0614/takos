/**
 * Abort Signal 用ユーティリティ
 *
 * Takos の各サービス横断で AbortSignal を扱うための共通ヘルパー。
 */

import { AppError } from "./errors.ts";

/**
 * 複数の AbortSignal を 1 つに結合する。 いずれかが abort したら
 * 返却した signal も abort し、 全ての親 signal から listener を
 * 確実に detach する。
 *
 * 重要: ナイーブな `addEventListener("abort", …, { once: true })`
 * 実装は、 親 signal が abort しないままなら listener が解除されない。
 * 長寿命の親 signal に対して短命の組み合わせを大量に作るパターン
 * (例: 1 セッション × 多数の per-call timeout) では listener が
 * 親側に蓄積する。 本関数は combined signal が abort した時点で
 * 全 listener を明示的に detach することで、 この leak を防ぐ。
 *
 * @param signals - 結合対象の AbortSignal 配列。 空でも構わない。
 * @returns 結合された AbortSignal。 入力が空なら abort されない signal を返す。
 */
export function combineSignals(
  ...signals: (AbortSignal | undefined | null)[]
): AbortSignal {
  return combineSignalsWithCleanup(...signals).signal;
}

export type CombinedAbortSignal = {
  signal: AbortSignal;
  cleanup: () => void;
};

/**
 * `combineSignals` と同じ結合 signal に加えて、操作完了時に親 signal から
 * listener を外す cleanup を返す。親が abort しない successful call の後でも
 * listener を残したくない per-call transport で使う。
 */
export function combineSignalsWithCleanup(
  ...signals: (AbortSignal | undefined | null)[]
): CombinedAbortSignal {
  const filtered = signals.filter((s): s is AbortSignal => s != null);
  const controller = new AbortController();

  // 既に abort 済みのものがあれば即座に伝播。
  for (const signal of filtered) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return { signal: controller.signal, cleanup: () => {} };
    }
  }

  const listeners: { signal: AbortSignal; handler: () => void }[] = [];

  const cleanup = () => {
    for (const { signal, handler } of listeners) {
      signal.removeEventListener("abort", handler);
    }
    listeners.length = 0;
  };

  for (const signal of filtered) {
    const handler = () => {
      controller.abort(signal.reason);
      cleanup();
    };
    signal.addEventListener("abort", handler);
    listeners.push({ signal, handler });
  }

  // combined signal 自身が abort した場合 (e.g. external `controller.abort()`
  // 経由) も親 signal から listener を必ず detach する。
  controller.signal.addEventListener("abort", cleanup, { once: true });

  return { signal: controller.signal, cleanup };
}

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
