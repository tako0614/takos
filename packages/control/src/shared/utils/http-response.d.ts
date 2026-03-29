/**
 * Lightweight helpers that create `application/json` `Response` objects.
 *
 * Use these in contexts where a Hono `Context` is not available (e.g. plain
 * `fetch` handlers, Durable Object workers, non-Hono service workers).
 * In Hono route handlers prefer `c.json()` instead.
 */
/**
 * Build a JSON `Response` with the given data and HTTP status.
 *
 * @param data   - Value to serialise as the response body.
 * @param status - HTTP status code (defaults to 200).
 */
export declare function jsonResponse<T>(data: T, status?: number): Response;
/**
 * Build a JSON error `Response`.
 *
 * Produces `{ error, ...details }` at the given status (defaults to 400).
 *
 * @param error   - Human-readable error message.
 * @param status  - HTTP status code (defaults to 400).
 * @param details - Optional extra fields merged into the response body.
 */
export declare function errorJsonResponse(error: string, status?: number, details?: Record<string, unknown>): Response;
//# sourceMappingURL=http-response.d.ts.map