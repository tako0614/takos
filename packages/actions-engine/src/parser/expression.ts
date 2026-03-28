/**
 * GitHub Actions expression evaluator
 * Handles ${{ }} expressions with variable substitution and simple evaluation
 *
 * This module is the public API surface. Implementation is split across:
 * - tokenizer.ts: Token types and tokenization logic
 * - evaluator.ts: Expression parsing and evaluation
 */
import { MAX_EXPRESSION_SIZE } from '../constants.js';
import type { ExecutionContext } from '../types.js';
import { ExpressionError, tokenize } from './tokenizer.js';
import { ExpressionEvaluator } from './evaluator.js';

// Re-export for consumers that import from this module
export { ExpressionError } from './tokenizer.js';

/**
 * Extract expression content from ${{ }} wrapper.
 * Returns the inner expression if wrapped, or the input unchanged.
 */
function extractExpression(expr: string): string {
  const match = expr.match(/^\$\{\{\s*([\s\S]*?)\s*\}\}$/);
  return match ? match[1] : expr;
}

/**
 * Evaluate a single expression
 */
/** @internal - not re-exported from the package index */
export function evaluateExpression(
  expr: string,
  context: ExecutionContext
): unknown {
  const innerExpr = extractExpression(expr);
  if (innerExpr.length > MAX_EXPRESSION_SIZE) {
    throw new ExpressionError(
      `Expression size limit exceeded: ${MAX_EXPRESSION_SIZE}`,
      expr
    );
  }
  const tokens = tokenize(innerExpr);
  const evaluator = new ExpressionEvaluator(tokens, context, innerExpr);
  return evaluator.evaluate();
}

/** Pattern for matching ${{ }} expressions */
const EXPRESSION_PATTERN = /\$\{\{([\s\S]+?)\}\}/g;

/**
 * Interpolate all expressions in a string
 */
export function interpolateString(
  template: string,
  context: ExecutionContext
): string {
  return template.replace(EXPRESSION_PATTERN, (match) => {
    try {
      const result = evaluateExpression(match, context);
      if (result === undefined || result === null) {
        return '';
      }
      if (typeof result === 'object') {
        return JSON.stringify(result);
      }
      return String(result);
    } catch (err) {
      // Log the error for debugging but return empty string to avoid
      // exposing raw ${{ }} expressions in workflow output.
      if (typeof process !== 'undefined' && process.stderr) {
        process.stderr.write(`[actions-engine] Expression evaluation error: ${err instanceof Error ? err.message : String(err)}\n`);
      }
      return '';
    }
  });
}

/**
 * Convert an expression result to a condition boolean.
 *
 * This intentionally differs from the evaluator's internal toBoolean():
 * the string 'false' is treated as falsy, matching GitHub Actions behavior
 * for `if:` conditions.
 */
function resultToConditionBoolean(result: unknown): boolean {
  if (result === null || result === undefined || result === '') {
    return false;
  }
  if (typeof result === 'boolean') {
    return result;
  }
  if (typeof result === 'number') {
    return result !== 0;
  }
  if (typeof result === 'string') {
    return result.length > 0 && result !== 'false';
  }
  return true;
}

/**
 * Evaluate a condition (if: expression)
 */
export function evaluateCondition(
  condition: string | undefined,
  context: ExecutionContext
): boolean {
  if (condition === undefined || condition === '') {
    return true;
  }

  try {
    // If not wrapped in ${{ }}, wrap it
    const expr = condition.startsWith('${{')
      ? condition
      : `\${{ ${condition} }}`;
    const result = evaluateExpression(expr, context);
    return resultToConditionBoolean(result);
  } catch {
    return false;
  }
}

/**
 * Interpolate environment variables and expressions in an object
 */
export function interpolateObject<T extends Record<string, unknown>>(
  obj: T,
  context: ExecutionContext
): T {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = interpolateString(value, context);
    } else if (Array.isArray(value)) {
      result[key] = value.map((item) =>
        typeof item === 'string'
          ? interpolateString(item, context)
          : typeof item === 'object' && item !== null
            ? interpolateObject(item as Record<string, unknown>, context)
            : item
      );
    } else if (typeof value === 'object' && value !== null) {
      result[key] = interpolateObject(
        value as Record<string, unknown>,
        context
      );
    } else {
      result[key] = value;
    }
  }

  return result as T;
}
