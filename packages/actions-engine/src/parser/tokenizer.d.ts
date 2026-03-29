/**
 * Expression tokenizer
 * Handles lexical analysis of GitHub Actions expressions
 */
/**
 * Expression evaluation error
 */
/** @internal - not re-exported from the package index */
export declare class ExpressionError extends Error {
    readonly expression: string;
    constructor(message: string, expression: string);
}
/**
 * Token types for expression lexer
 */
export type TokenType = 'identifier' | 'number' | 'string' | 'boolean' | 'null' | 'operator' | 'dot' | 'lparen' | 'rparen' | 'lbracket' | 'rbracket' | 'comma' | 'eof';
export interface Token {
    type: TokenType;
    value: string | number | boolean | null;
    raw: string;
}
/**
 * Simple tokenizer for expressions
 */
export declare function tokenize(expr: string): Token[];
//# sourceMappingURL=tokenizer.d.ts.map