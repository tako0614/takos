import type { Context, MiddlewareHandler } from "hono";

type ContentTypeOptions = {
  allowedTypes?: string[];
  allowEmptyBody?: boolean;
};

const DEFAULT_ALLOWED_TYPES = ["application/json"];

export function validateContentType(
  options: ContentTypeOptions = {},
): MiddlewareHandler {
  const allowedTypes = options.allowedTypes || DEFAULT_ALLOWED_TYPES;
  const allowEmptyBody = options.allowEmptyBody ?? true;

  return async (c: Context, next): Promise<Response | void> => {
    const method = c.req.method;

    if (!["POST", "PUT", "PATCH"].includes(method)) {
      await next();
      return;
    }

    const contentType = c.req.header("Content-Type");
    const contentLength = c.req.header("Content-Length");

    if (allowEmptyBody && (!contentLength || contentLength === "0")) {
      await next();
      return;
    }

    if (!contentType) {
      // Common error envelope: { error: { code, message } }
      return c.json({
        error: {
          code: "MISSING_CONTENT_TYPE",
          message: "Missing Content-Type header",
        },
      }, 415);
    }

    const baseContentType = contentType.split(";")[0].trim().toLowerCase();

    const isAllowed = allowedTypes.some((allowed) => {
      const normalizedAllowed = allowed.toLowerCase();
      if (normalizedAllowed.endsWith("/*")) {
        const prefix = normalizedAllowed.slice(0, -2);
        return baseContentType.startsWith(prefix + "/");
      }
      return baseContentType === normalizedAllowed;
    });

    if (!isAllowed) {
      // Common error envelope: { error: { code, message } }
      return c.json({
        error: {
          code: "UNSUPPORTED_CONTENT_TYPE",
          message: `Unsupported Content-Type: ${baseContentType}`,
        },
        allowed: allowedTypes,
      }, 415);
    }

    await next();
  };
}
