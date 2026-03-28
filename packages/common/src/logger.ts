/**
 * Structured Logger for Takos Platform
 *
 * Zero-dependency structured logging compatible with Cloudflare Workers.
 * Outputs JSON to console methods so CF observability picks up the correct level.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

interface LogEntry {
  level: LogLevel;
  msg: string;
  ts: string;
  service?: string;
  [key: string]: unknown;
}

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

function serializeError(value: unknown): Record<string, unknown> {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  return { message: String(value) };
}

function formatData(data?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!data) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value instanceof Error) {
      result[key] = serializeError(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

const LEVEL_NAMES = Object.fromEntries(
  Object.entries(LEVEL_ORDER).map(([k, v]) => [v, k])
) as Record<number, LogLevel>;

class LoggerImpl implements Logger {
  private minLevel: number;
  private service?: string;
  private fields: Record<string, unknown>;

  constructor(opts?: LoggerOptions & { _fields?: Record<string, unknown> }) {
    this.minLevel = LEVEL_ORDER[opts?.level ?? 'debug'];
    this.service = opts?.service;
    this.fields = { ...opts?.defaultFields, ...opts?._fields };
  }

  private emit(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (LEVEL_ORDER[level] < this.minLevel) return;

    const entry: LogEntry = {
      level,
      msg,
      ts: new Date().toISOString(),
      ...(this.service ? { service: this.service } : {}),
      ...this.fields,
      ...formatData(data),
    };

    const line = JSON.stringify(entry);
    switch (level) {
      case 'debug':
        // eslint-disable-next-line no-console -- logger implementation
        console.log(line);
        break;
      case 'info':
        // eslint-disable-next-line no-console -- logger implementation
        console.log(line);
        break;
      case 'warn':
        console.warn(line);
        break;
      case 'error':
        console.error(line);
        break;
    }
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.emit('debug', msg, data);
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.emit('info', msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.emit('warn', msg, data);
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.emit('error', msg, data);
  }

  child(fields: Record<string, unknown>): Logger {
    return new LoggerImpl({
      level: LEVEL_NAMES[this.minLevel],
      service: this.service,
      _fields: { ...this.fields, ...fields },
    });
  }
}

export function createLogger(opts?: LoggerOptions): Logger {
  return new LoggerImpl(opts);
}
