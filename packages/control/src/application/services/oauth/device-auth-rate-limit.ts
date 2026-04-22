/**
 * In-memory rate-limiting helpers for device authorization user-code lookups.
 *
 * Shared between the server-rendered device flow (`/oauth/device`) and the
 * JSON consent API (`/api/oauth/device/*`).
 */

export const DEVICE_USER_CODE_MAX_ATTEMPTS = 10;
export const DEVICE_USER_CODE_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

const deviceUserCodeAttempts = new Map<
  string,
  { attempts: number; firstAttemptAt: number }
>();

export function cleanupExpiredDeviceCodeAttempts(now = Date.now()): void {
  for (const [code, state] of Array.from(deviceUserCodeAttempts.entries())) {
    if (now - state.firstAttemptAt >= DEVICE_USER_CODE_WINDOW_MS) {
      deviceUserCodeAttempts.delete(code);
    }
  }
}

export function isDeviceUserCodeLimited(
  userCode: string,
  now = Date.now(),
): boolean {
  cleanupExpiredDeviceCodeAttempts(now);
  const state = deviceUserCodeAttempts.get(userCode);
  if (!state) return false;
  return state.attempts >= DEVICE_USER_CODE_MAX_ATTEMPTS;
}

export function recordDeviceUserCodeAttempt(
  userCode: string,
  now = Date.now(),
): void {
  cleanupExpiredDeviceCodeAttempts(now);
  const state = deviceUserCodeAttempts.get(userCode);
  if (!state) {
    deviceUserCodeAttempts.set(userCode, { attempts: 1, firstAttemptAt: now });
    return;
  }
  state.attempts += 1;
}

export function clearDeviceUserCodeAttempts(userCode: string): void {
  deviceUserCodeAttempts.delete(userCode);
}
