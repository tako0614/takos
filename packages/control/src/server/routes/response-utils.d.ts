import type { Context } from 'hono';
/** Standard success response for mutations (create/update/delete) */
export declare function ok(c: Context, status?: 200 | 201 | 204): (Response & import("hono").TypedResponse<null, 204, "body">) | (Response & import("hono").TypedResponse<{
    success: true;
}, 200 | 201, "json">);
/** Standard data response wrapping a single resource */
export declare function data<T>(c: Context, resource: T, status?: 200 | 201): Response & import("hono").TypedResponse<{
    data: T;
} extends infer T_1 ? T_1 extends {
    data: T;
} ? T_1 extends Map<unknown, unknown> | Set<unknown> | Record<string, never> ? {} : T_1 extends object ? T_1[keyof T_1] extends bigint | readonly bigint[] ? never : { [K_1 in keyof { [K in keyof T_1 as K extends symbol ? never : K]: T_1[K]; } as (T_1[K_1] extends infer T_2 ? T_2 extends T_1[K_1] ? T_2 extends import("hono/utils/types").InvalidJSONValue ? true : false : never : never) extends true ? never : K_1]: boolean extends (T_1[K_1] extends infer T_3 ? T_3 extends T_1[K_1] ? T_3 extends import("hono/utils/types").InvalidJSONValue ? true : false : never : never) ? import("hono/utils/types").JSONParsed<T_1[K_1], bigint | readonly bigint[]> | undefined : import("hono/utils/types").JSONParsed<T_1[K_1], bigint | readonly bigint[]>; } : T_1 extends unknown ? T_1 extends bigint | readonly bigint[] ? never : import("hono/utils/types").JSONValue : never : never : never, 200 | 201, "json">;
/** Standard list response with pagination */
export declare function list<T>(c: Context, items: T[], total: number, limit: number, offset: number): Response & import("hono").TypedResponse<{
    data: import("hono/utils/types").JSONParsed<T extends import("hono/utils/types").InvalidJSONValue ? null : T, bigint | readonly bigint[]>[];
    total: number;
    has_more: boolean;
    limit: number;
    offset: number;
}, import("hono/utils/http-status").ContentfulStatusCode, "json">;
//# sourceMappingURL=response-utils.d.ts.map