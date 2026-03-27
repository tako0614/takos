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
export function jsonResponse<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Build a JSON error `Response`.
 *
 * Produces `{ error, ...details }` at the given status (defaults to 400).
 *
 * @param error   - Human-readable error message.
 * @param status  - HTTP status code (defaults to 400).
 * @param details - Optional extra fields merged into the response body.
 */
export function errorJsonResponse(
  error: string,
  status = 400,
  details?: Record<string, unknown>,
): Response {
  return jsonResponse({ error, ...details }, status);
}
