import type { Context } from "hono";
import type { AppError } from "takos-common/errors";

const PUBLIC_INTERNAL_FIELD_NAMES = new Set([
  "backend",
  "backendName",
  "backend_name",
  "backendState",
  "backendStateJson",
  "backend_state",
  "backend_state_json",
  "backingResourceId",
  "backing_resource_id",
  "backingResourceName",
  "backing_resource_name",
]);

export function hasPublicInternalField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => hasPublicInternalField(entry));
  }
  if (!value || typeof value !== "object") {
    return false;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (PUBLIC_INTERNAL_FIELD_NAMES.has(key)) {
      return true;
    }
    if (hasPublicInternalField(entry)) {
      return true;
    }
  }
  return false;
}

export function stripPublicInternalFields<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((entry) => stripPublicInternalFields(entry)) as T;
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (PUBLIC_INTERNAL_FIELD_NAMES.has(key)) {
      continue;
    }
    result[key] = stripPublicInternalFields(entry);
  }
  return result as T;
}

/** Standard success response for mutations (create/update/delete) */
export function ok(c: Context, status: 200 | 201 | 204 = 200) {
  if (status === 204) return c.body(null, 204);
  return c.json({ success: true }, status);
}

/** Standard data response wrapping a single resource */
export function data<T>(c: Context, resource: T, status: 200 | 201 = 200) {
  return c.json({ data: resource }, status);
}

/** Standard list response with pagination */
export function list<T>(
  c: Context,
  items: T[],
  total: number,
  limit: number,
  offset: number,
) {
  return c.json({
    data: items,
    total,
    has_more: offset + items.length < total,
    limit,
    offset,
  });
}

export function errorResponse(error: AppError): Response {
  return new Response(JSON.stringify(error.toResponse()), {
    status: error.statusCode,
    headers: { "Content-Type": "application/json" },
  });
}
