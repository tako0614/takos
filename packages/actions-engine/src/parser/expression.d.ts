import type { ExecutionContext } from '../workflow-models.js';
export { ExpressionError } from './tokenizer.js';
/**
 * Evaluate a single expression
 */
/** @internal - not re-exported from the package index */
export declare function evaluateExpression(expr: string, context: ExecutionContext): unknown;
/**
 * Interpolate all expressions in a string
 */
export declare function interpolateString(template: string, context: ExecutionContext): string;
/**
 * Evaluate a condition (if: expression)
 */
export declare function evaluateCondition(condition: string | undefined, context: ExecutionContext): boolean;
/**
 * Interpolate environment variables and expressions in an object
 */
export declare function interpolateObject<T extends Record<string, unknown>>(obj: T, context: ExecutionContext): T;
//# sourceMappingURL=expression.d.ts.map