import type { ExecutionContext } from '../workflow-models.js';
export declare function fnContains(args: unknown[]): boolean;
export declare function fnStartsWith(args: unknown[]): boolean;
export declare function fnEndsWith(args: unknown[]): boolean;
export declare function fnFormat(args: unknown[]): string;
export declare function fnJoin(args: unknown[]): string;
export declare function fnToJSON(args: unknown[]): string;
export declare function fnFromJSON(args: unknown[]): unknown;
export declare function fnHashFiles(args: unknown[], context: ExecutionContext): string;
export declare function fnSuccess(context: ExecutionContext): boolean;
export declare function fnAlways(): boolean;
export declare function fnCancelled(context: ExecutionContext): boolean;
export declare function fnFailure(context: ExecutionContext): boolean;
//# sourceMappingURL=evaluator-builtins.d.ts.map