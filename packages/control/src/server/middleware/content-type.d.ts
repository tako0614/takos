import type { MiddlewareHandler } from 'hono';
type ContentTypeOptions = {
    allowedTypes?: string[];
    allowEmptyBody?: boolean;
};
export declare function validateContentType(options?: ContentTypeOptions): MiddlewareHandler;
export {};
//# sourceMappingURL=content-type.d.ts.map