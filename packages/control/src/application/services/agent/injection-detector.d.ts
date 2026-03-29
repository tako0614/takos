/**
 * Prompt Injection Detection.
 *
 * Extracted from skills.ts to provide reusable security
 * validation for skill content and user inputs.
 */
/**
 * Check whether a workspace has exceeded the injection-attempt rate limit.
 *
 * Returns `true` when the limit is exceeded, indicating the request should
 * be rejected or the content should be blocked.
 *
 * Periodically prunes stale entries to prevent unbounded memory growth.
 */
export declare function checkInjectionRateLimit(spaceId: string): boolean;
/**
 * Multi-language prompt injection patterns.
 *
 * Covers English, Japanese, Chinese, and Korean attack vectors including
 * instruction override attempts, system prompt manipulation, and
 * jailbreak keywords.
 */
export declare const INJECTION_PATTERNS: RegExp[];
/**
 * Result of a prompt injection detection check.
 */
export interface InjectionDetectionResult {
    /** Whether an injection pattern was detected. */
    detected: boolean;
    /** String representation of the matching pattern, if any. */
    pattern?: string;
    /** Whether the workspace has exceeded the rate limit for injection attempts. */
    rateLimited?: boolean;
}
/**
 * Scan content for known prompt injection patterns.
 *
 * Optionally checks the workspace-level rate limit when `spaceId` is
 * provided, returning whether the workspace should be throttled.
 */
export declare function detectPromptInjection(content: string, spaceId?: string): InjectionDetectionResult;
/**
 * Sanitize user-provided skill content by stripping control characters,
 * detecting injection attempts, and enforcing length limits.
 *
 * When injection is detected, the content is wrapped in safety markers.
 * When the rate limit is exceeded, the content is rejected entirely.
 */
export declare function sanitizeSkillContent(content: string, maxLength: number, fieldName: string, spaceId?: string): string;
//# sourceMappingURL=injection-detector.d.ts.map