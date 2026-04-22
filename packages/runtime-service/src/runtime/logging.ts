import { MAX_LOG_LINES } from "../shared/config.ts";
import type { SecretsSanitizer } from "./actions/secrets.ts";

const MAX_LOG_LINE_LENGTH = 10_000;

export const loggingDeps = {
  maxLogLines: MAX_LOG_LINES,
};

export function pushLog(
  logs: string[],
  message: string,
  sanitizer?: SecretsSanitizer,
): void {
  if (logs.length >= loggingDeps.maxLogLines) {
    if (logs.length === loggingDeps.maxLogLines) {
      logs.push("...log truncated");
    }
    return;
  }

  let sanitizedMessage = sanitizer ? sanitizer.sanitize(message) : message;

  if (sanitizedMessage.length > MAX_LOG_LINE_LENGTH) {
    sanitizedMessage = sanitizedMessage.slice(0, MAX_LOG_LINE_LENGTH) +
      "...[truncated]";
  }

  logs.push(sanitizedMessage);
}
