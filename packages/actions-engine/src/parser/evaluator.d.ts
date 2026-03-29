import type { ExecutionContext } from '../workflow-models.js';
import type { Token } from './tokenizer.js';
/**
 * Simple expression parser and evaluator
 */
export declare class ExpressionEvaluator {
    private readonly tokens;
    private pos;
    private readonly context;
    private readonly expression;
    private evaluateCallCount;
    private readonly contextMap;
    constructor(tokens: Token[], context: ExecutionContext, expression: string);
    private current;
    private advance;
    private match;
    private expect;
    private tokenSource;
    private getIdentifierValue;
    /**
     * Parse and evaluate expression
     */
    evaluate(): unknown;
    private parseOr;
    private parseAnd;
    private parseComparison;
    private parseUnary;
    private checkAccessDepth;
    private parseAccess;
    private parsePrimary;
    private parseFunction;
    private getContextValue;
    private getProperty;
    private compare;
    private toBoolean;
    private callFunction;
}
//# sourceMappingURL=evaluator.d.ts.map