/**
 * Structured Logger for Takos Platform
 *
 * Zero-dependency structured logging compatible with Cloudflare Workers.
 * Outputs JSON to console methods so CF observability picks up the correct level.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
interface LoggerOptions {
    service?: string;
    level?: LogLevel;
    defaultFields?: Record<string, unknown>;
}
export interface Logger {
    debug(msg: string, data?: Record<string, unknown>): void;
    info(msg: string, data?: Record<string, unknown>): void;
    warn(msg: string, data?: Record<string, unknown>): void;
    error(msg: string, data?: Record<string, unknown>): void;
    child(fields: Record<string, unknown>): Logger;
}
export declare function createLogger(opts?: LoggerOptions): Logger;
export {};
//# sourceMappingURL=logger.d.ts.map