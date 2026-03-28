import type { Context } from 'hono';

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
export function list<T>(c: Context, items: T[], total: number, limit: number, offset: number) {
  return c.json({
    data: items,
    total,
    has_more: offset + items.length < total,
    limit,
    offset,
  });
}
