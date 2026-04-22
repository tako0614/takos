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
import type { LogLevel } from "takos-common";
export type { LogLevel };

export interface LogContext {
  requestId?: string;
  userId?: string;
  action?: string;
  [key: string]: unknown;
}

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  context?: LogContext;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

type JsonParseContext =
  | string
  | {
    service?: string;
    field?: string;
  };

const SENSITIVE_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  {
    pattern:
      /\b(api[_-]?key|apikey|api_token)[=:]\s*["']?([a-zA-Z0-9_-]{16,256})["']?/gi,
    replacement: "$1=[REDACTED]",
  },
  {
    pattern: /\b(Bearer|token)\s+([a-zA-Z0-9_.-]{20,256})/gi,
    replacement: "$1 [REDACTED]",
  },
  { pattern: /\b(sk-[a-zA-Z0-9]{20,128})/g, replacement: "[REDACTED_SK]" },
  { pattern: /\b(ghp_[a-zA-Z0-9]{36,128})/g, replacement: "[REDACTED_GHP]" },
  { pattern: /\b(gho_[a-zA-Z0-9]{36,128})/g, replacement: "[REDACTED_GHO]" },
  {
    pattern:
      /\b(password|passwd|pwd|secret)[=:]\s*["']?([^"'\s,}{]{1,256})["']?/gi,
    replacement: "$1=[REDACTED]",
  },
  {
    pattern:
      /\b(session[_-]?id|sessionid|auth[_-]?token)[=:]\s*["']?([a-zA-Z0-9_-]{20,256})["']?/gi,
    replacement: "$1=[REDACTED]",
  },
  {
    pattern: /\b(\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4})\b/g,
    replacement: "[REDACTED_CC]",
  },
  {
    pattern: /([a-zA-Z0-9._%+-]{1,64})@([a-zA-Z0-9.-]{1,255}\.[a-zA-Z]{2,10})/g,
    replacement: "***@$2",
  },
  {
    pattern:
      /\beyJ[a-zA-Z0-9_-]{1,2048}\.eyJ[a-zA-Z0-9_-]{1,2048}\.[a-zA-Z0-9_-]{1,512}/g,
    replacement: "[REDACTED_JWT]",
  },
  {
    pattern:
      /-----BEGIN\s+(RSA\s+)?PRIVATE KEY-----[\s\S]{1,8192}?-----END\s+(RSA\s+)?PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
  {
    pattern: /\b(AKIA[0-9A-Z]{16})/g,
    replacement: "[REDACTED_AWS_ACCESS_KEY]",
  },
  {
    pattern:
      /\b(aws[_-]?secret[_-]?access[_-]?key)[=:]\s*["']?([a-zA-Z0-9/+=]{40})["']?/gi,
    replacement: "$1=[REDACTED]",
  },
];

function maskSensitiveData(input: string): string {
  let result = input;
  for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

function maskSensitiveInObject(obj: unknown): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "string") {
    return maskSensitiveData(obj);
  }

  if (Array.isArray(obj)) {
    return obj.map(maskSensitiveInObject);
  }

  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const lowerKey = key.toLowerCase();
      if (
        lowerKey.includes("password") ||
        lowerKey.includes("secret") ||
        lowerKey.includes("token") ||
        lowerKey.includes("apikey") ||
        lowerKey.includes("api_key") ||
        lowerKey.includes("credential") ||
        lowerKey.includes("private")
      ) {
        result[key] = "[REDACTED]";
      } else {
        result[key] = maskSensitiveInObject(value);
      }
    }
    return result;
  }

  return obj;
}

function formatJsonParseContext(context?: JsonParseContext): string {
  if (!context) return "unknown";
  if (typeof context === "string") return context;

  const parts: string[] = [];
  if (context.service) parts.push(context.service);
  if (context.field) parts.push(context.field);
  return parts.length > 0 ? parts.join(".") : "unknown";
}

export function safeJsonParse<T>(
  value: unknown,
  context?: JsonParseContext,
): T | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value !== "string") {
    if (typeof value === "object") {
      return value as T;
    }
    return null;
  }

  try {
    return JSON.parse(value) as T;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logWarn(`Failed to parse JSON`, {
      module: "json",
      context: formatJsonParseContext(context),
      parseError: message,
    });
    return null;
  }
}

export function safeJsonParseOrDefault<T>(
  value: unknown,
  fallback: T,
  context?: JsonParseContext,
): T {
  const parsed = safeJsonParse<T>(value, context);
  return parsed === null ? fallback : parsed;
}

function createLogEntry(
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: Error,
): LogEntry {
  const entry: LogEntry = {
    level,
    message: maskSensitiveData(message),
    timestamp: new Date().toISOString(),
  };

  if (context && Object.keys(context).length > 0) {
    entry.context = maskSensitiveInObject(context) as LogContext;
  }

  if (error) {
    entry.error = {
      name: error.name,
      message: maskSensitiveData(error.message),
      stack: error.stack ? maskSensitiveData(error.stack) : undefined,
    };
  }

  return entry;
}

export function logDebug(message: string, context?: LogContext): void {
  const entry = createLogEntry("debug", message, context);
  console.debug(JSON.stringify(entry));
}

export function logInfo(message: string, context?: LogContext): void {
  const entry = createLogEntry("info", message, context);
  console.info(JSON.stringify(entry));
}

export function logWarn(message: string, context?: LogContext): void {
  const entry = createLogEntry("warn", message, context);
  console.warn(JSON.stringify(entry));
}

export function logError(
  message: string,
  error?: Error | unknown,
  context?: LogContext,
): void {
  const err = error instanceof Error ? error : undefined;
  const entry = createLogEntry("error", message, context, err);

  if (error && !(error instanceof Error)) {
    entry.context = {
      ...entry.context,
      errorValue: String(error),
    };
  }

  console.error(JSON.stringify(entry));
}

export function createLogger(baseContext: LogContext) {
  return {
    debug: (message: string, context?: LogContext) =>
      logDebug(message, { ...baseContext, ...context }),
    info: (message: string, context?: LogContext) =>
      logInfo(message, { ...baseContext, ...context }),
    warn: (message: string, context?: LogContext) =>
      logWarn(message, { ...baseContext, ...context }),
    error: (message: string, error?: Error | unknown, context?: LogContext) =>
      logError(message, error, { ...baseContext, ...context }),
  };
}
