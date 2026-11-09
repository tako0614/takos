import type { Context, MiddlewareHandler } from "hono";

type BodySizeLimitOptions = {
  maxSize: number;
  message?: string;
  skipPaths?: RegExp[];
};

export function bodyLimit(options: BodySizeLimitOptions): MiddlewareHandler {
  const { maxSize, message, skipPaths } = options;

  // Return this Response to Hono, including when no handler was reached.
  const tooLarge = (c: Context) =>
    c.json(
      {
        error: {
          code: "PAYLOAD_TOO_LARGE",
          message: message || "Request body too large",
        },
        max_size: maxSize,
      },
      413,
    );

  return async (c, next) => {
    const request = c.req.raw;
    if (
      request.body === null ||
      skipPaths?.some((pattern) => pattern.test(c.req.path))
    ) {
      return next();
    }

    // Content-Length can reject before reading, but it cannot replace the
    // actual byte count. Keep the existing Transfer-Encoding precedence.
    if (!request.headers.has("transfer-encoding")) {
      const length = Number.parseInt(
        request.headers.get("content-length") || "0",
        10,
      );
      if (length > maxSize) return tooLarge(c);
    }

    // Buffer at most the configured limit before auth/route parsing, as before.
    // This also prevents a route's JSON-error catch from swallowing overflow.
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxSize) {
          // Stop the source without letting cancellation failure hide the 413.
          void reader.cancel().catch(() => {});
          return tooLarge(c);
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }

    // Clone the original Request so runtime metadata and request options survive.
    c.req.raw = new Request(request, {
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(chunk);
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    return next();
  };
}

export const generalApiBodyLimit = bodyLimit({
  maxSize: 1 * 1024 * 1024, // 1MB
  message: "Request body exceeds maximum allowed size of 1MB",
});

export const searchBodyLimit = bodyLimit({
  maxSize: 256 * 1024, // 256KB
  message: "Request body exceeds maximum allowed size of 256KB",
});
