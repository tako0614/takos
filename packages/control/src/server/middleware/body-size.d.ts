import type { MiddlewareHandler } from 'hono';
type BodySizeLimitOptions = {
    maxSize: number;
    message?: string;
    skipPaths?: RegExp[];
};
export declare function bodyLimit(options: BodySizeLimitOptions): MiddlewareHandler;
export declare const generalApiBodyLimit: MiddlewareHandler;
export declare const oauthBodyLimit: MiddlewareHandler;
export declare const searchBodyLimit: MiddlewareHandler;
export {};
//# sourceMappingURL=body-size.d.ts.map