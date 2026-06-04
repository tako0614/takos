export type Logger = {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(fields: Record<string, unknown>): Logger;
};

export function createLogger(options: {
  service?: string;
  defaultFields?: Record<string, unknown>;
} = {}): Logger {
  const baseFields = options.defaultFields ?? {};

  function write(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    meta: Record<string, unknown> = {},
  ) {
    const record = {
      level,
      service: options.service,
      message,
      ...baseFields,
      ...meta,
    };
    const line = JSON.stringify(record);
    if (level === "error") {
      console.error(line);
    } else if (level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }

  return {
    debug: (message, meta) => write("debug", message, meta),
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta),
    child: (fields) =>
      createLogger({
        service: options.service,
        defaultFields: { ...baseFields, ...fields },
      }),
  };
}
