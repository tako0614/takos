/**
 * Control-specific structured logger.
 *
 * NOT a duplicate of takos-common's logger.  This module provides:
 *  - Automatic sensitive-data masking (tokens, passwords, JWTs, PII, etc.)
 *  - Standalone function API (logDebug/logInfo/logWarn/logError) used by 160+ files
 *  - safeJsonParse / safeJsonParseOrDefault helpers integrated with log warnings
 *  - LogContext with requestId / userId / action fields
 *
 * takos-common's logger is a class-based, zero-feature structured logger
 * (no masking, no JSON-parse helpers).  Merging would either strip security
 * features from control or bloat the shared package.
 */
import type { LogLevel } from 'takos-common';
export type { LogLevel };
export interface LogContext {
    requestId?: string;
    userId?: string;
    action?: string;
    [key: string]: unknown;
}
type JsonParseContext = string | {
    service?: string;
    field?: string;
};
export declare function safeJsonParse<T>(value: unknown, context?: JsonParseContext): T | null;
export declare function safeJsonParseOrDefault<T>(value: unknown, fallback: T, context?: JsonParseContext): T;
export declare function logDebug(message: string, context?: LogContext): void;
export declare function logInfo(message: string, context?: LogContext): void;
export declare function logWarn(message: string, context?: LogContext): void;
export declare function logError(message: string, error?: Error | unknown, context?: LogContext): void;
export declare function createLogger(baseContext: LogContext): {
    debug: (message: string, context?: LogContext) => void;
    info: (message: string, context?: LogContext) => void;
    warn: (message: string, context?: LogContext) => void;
    error: (message: string, error?: Error | unknown, context?: LogContext) => void;
};
//# sourceMappingURL=logger.d.ts.map