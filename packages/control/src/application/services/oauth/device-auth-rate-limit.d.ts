/**
 * In-memory rate-limiting helpers for device authorization user-code lookups.
 *
 * Shared between the server-rendered device flow (`/oauth/device`) and the
 * JSON consent API (`/api/oauth/device/*`).
 */
export declare const DEVICE_USER_CODE_MAX_ATTEMPTS = 10;
export declare const DEVICE_USER_CODE_WINDOW_MS: number;
export declare function cleanupExpiredDeviceCodeAttempts(now?: number): void;
export declare function isDeviceUserCodeLimited(userCode: string, now?: number): boolean;
export declare function recordDeviceUserCodeAttempt(userCode: string, now?: number): void;
export declare function clearDeviceUserCodeAttempts(userCode: string): void;
//# sourceMappingURL=device-auth-rate-limit.d.ts.map