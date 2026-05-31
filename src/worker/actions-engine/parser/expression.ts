/**
 * GitHub Actions 式評価モジュール
 * `${{ }}` 式の変数展開と簡易評価を扱う
 *
 * このモジュールは公開 API のエントリポイント。実装は以下に分割:
 * - tokenizer.ts: トークン種別と字句解析ロジック
 * - evaluator.ts: 式のパースと評価
 */
import { MAX_EXPRESSION_SIZE } from "../constants.ts";
import type { ExecutionContext } from "../workflow-models.ts";
import { ExpressionError, tokenize } from "./tokenizer.ts";
import { ExpressionEvaluator } from "./evaluator.ts";
import process from "node:process";

// このモジュール経由で利用する場合の再エクスポート
export { ExpressionError } from "./tokenizer.ts";

/**
 * `${{ }}` のラッパーから実体式を抽出する
 * ラップされていれば内側式を、されていなければ入力文字列をそのまま返す
 */
function extractExpression(expr: string): string {
  const match = expr.match(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/);
  return match ? match[1] : expr;
}

/**
 * 単一式を評価する
 */
/** @internal - パッケージインデックスからは再エクスポートされない */
export function evaluateExpression(
  expr: string,
  context: ExecutionContext,
): unknown {
  const innerExpr = extractExpression(expr);
  if (innerExpr.length > MAX_EXPRESSION_SIZE) {
    throw new ExpressionError(
      `Expression size limit exceeded: ${MAX_EXPRESSION_SIZE}`,
      expr,
    );
  }
  const tokens = tokenize(innerExpr);
  const evaluator = new ExpressionEvaluator(tokens, context, innerExpr);
  return evaluator.evaluate();
}

/** `${{ }}` 式を検出するパターン */
const EXPRESSION_PATTERN = /\$\{\{([\s\S]+?)\}\}/g;

/**
 * 文字列中の式をすべて補間する
 */
export function interpolateString(
  template: string,
  context: ExecutionContext,
): string {
  return template.replace(EXPRESSION_PATTERN, (match) => {
    let result: unknown;
    try {
      result = evaluateExpression(match, context);
    } catch (err) {
      // fail-CLOSED: 式評価に失敗したら空文字へ握り潰さず、エラーを伝播する。
      // ここを空文字に倒すと `run:` コマンドや credential 断片
      // (例: `Authorization: Bearer ${{ ... }}`) が黙って欠落したまま実行され、
      // セキュリティ上問題のあるコマンド改変になる。呼び出し側 (step 実行 /
      // job outputs 評価) が捕捉して step / job を失敗させる。
      if (typeof process !== "undefined" && process.stderr) {
        process.stderr.write(
          `[actions-engine] Expression evaluation error: ${
            err instanceof Error ? err.message : String(err)
          }\n`,
        );
      }
      throw err;
    }
    // 値が genuinely-undefined / null の場合のみ空文字へ畳む
    // (GitHub Actions の未定義コンテキスト参照と同じ挙動)。
    if (result === undefined || result === null) {
      return "";
    }
    if (typeof result === "object") {
      return JSON.stringify(result);
    }
    return String(result);
  });
}

/**
 * 式評価結果を条件判定用ブール値へ変換する
 *
 * これは評価器の内部 toBoolean() と意図的に差をつけており、
 * 文字列 `'false'` は偽扱いにする。`if:` 条件の GitHub Actions 挙動と合わせるため。
 */
function resultToConditionBoolean(result: unknown): boolean {
  if (result === null || result === undefined || result === "") {
    return false;
  }
  if (typeof result === "boolean") {
    return result;
  }
  if (typeof result === "number") {
    return result !== 0;
  }
  if (typeof result === "string") {
    return result.length > 0 && result !== "false";
  }
  return true;
}

/**
 * 条件式 (`if:`) を評価する
 */
export function evaluateCondition(
  condition: string | undefined,
  context: ExecutionContext,
): boolean {
  if (condition === undefined || condition === "") {
    return true;
  }

  try {
    // `${{ }}` で囲まれていない場合は補間用に囲む
    const expr = condition.startsWith("${{")
      ? condition
      : `\${{ ${condition} }}`;
    const result = evaluateExpression(expr, context);
    return resultToConditionBoolean(result);
  } catch {
    return false;
  }
}

/** GitHub Actions の status-check 関数名 */
const STATUS_CHECK_FUNCTIONS = new Set(["always", "failure", "cancelled"]);

/**
 * `if:` 条件が status-check 関数 (`always()` / `failure()` / `cancelled()`)
 * を実際に「関数呼び出しとして」含むかを判定する。
 *
 * 生文字列への正規表現マッチではなくトークン列を見るため、
 * `env.MSG == 'always('` や `contains(x, 'failure(')` のような
 * 文字列リテラル中の出現は誤検出しない。tokenize に失敗する不正な式は、
 * status-check を含まない (= 抑制しない) ものとして安全側に倒す。
 */
export function conditionInvokesStatusFunction(
  condition: string | undefined,
): boolean {
  if (condition === undefined || condition === "") {
    return false;
  }
  let tokens;
  try {
    tokens = tokenize(extractExpression(condition));
  } catch {
    // 字句解析できない式は関数呼び出しとして扱わない (fail-closed: 抑制しない)。
    return false;
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    if (
      token.type === "identifier" &&
      typeof token.value === "string" &&
      STATUS_CHECK_FUNCTIONS.has(token.value) &&
      tokens[i + 1]?.type === "lparen"
    ) {
      return true;
    }
  }
  return false;
}

/**
 * オブジェクト内の環境変数と式を補間する
 */
export function interpolateObject<T extends Record<string, unknown>>(
  obj: T,
  context: ExecutionContext,
): T {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === "string") {
      result[key] = interpolateString(value, context);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === "string"
          ? interpolateString(item, context)
          : typeof item === "object" && item !== null
          ? interpolateObject(item as Record<string, unknown>, context)
          : item
      );
    } else if (typeof value === "object" && value !== null) {
      result[key] = interpolateObject(
        value as Record<string, unknown>,
        context,
      );
    } else {
      result[key] = value;
    }
  }

  return result as T;
}
