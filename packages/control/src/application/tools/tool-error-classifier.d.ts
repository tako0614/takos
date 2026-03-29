/**
 * Tool error codes, classification, and the ToolError class.
 *
 * Extracted from executor.ts to keep error-handling concerns in a single place.
 */
export declare const ErrorCodes: {
    readonly CONFIGURATION_ERROR: "E_CONFIG";
    readonly PERMISSION_DENIED: "E_PERMISSION";
    readonly UNAUTHORIZED: "E_UNAUTHORIZED";
    readonly NOT_FOUND: "E_NOT_FOUND";
    readonly INVALID_PATH: "E_INVALID_PATH";
    readonly VALIDATION_ERROR: "E_VALIDATION";
    readonly INVALID_INPUT: "E_INVALID_INPUT";
    readonly MISSING_REQUIRED: "E_MISSING_REQUIRED";
    readonly INVALID_ARGUMENT: "E_INVALID_ARGUMENT";
    readonly TIMEOUT: "E_TIMEOUT";
    readonly NETWORK_ERROR: "E_NETWORK";
    readonly SERVICE_UNAVAILABLE: "E_SERVICE_UNAVAILABLE";
    readonly RATE_LIMITED: "E_RATE_LIMITED";
    readonly INTERNAL_ERROR: "E_INTERNAL";
};
export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];
export type ErrorSeverity = 'fatal' | 'retriable' | 'user_error';
export declare class ToolError extends Error {
    readonly code: ErrorCode;
    readonly cause?: Error | undefined;
    constructor(message: string, code: ErrorCode, cause?: Error | undefined);
    get severity(): ErrorSeverity;
}
export declare function classifyError(error: Error): {
    severity: ErrorSeverity;
    code?: ErrorCode;
};
/** Human-readable hints appended to error messages based on severity. */
export declare const SEVERITY_HINTS: Record<string, string>;
//# sourceMappingURL=tool-error-classifier.d.ts.map