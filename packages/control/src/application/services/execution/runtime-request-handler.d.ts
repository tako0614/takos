import type { DbEnv } from '../../../shared/types';
type RuntimeEnv = DbEnv & {
    RUNTIME_HOST?: {
        fetch(request: Request): Promise<Response>;
    };
};
export declare function callRuntimeRequest(env: RuntimeEnv, endpoint: string, options?: {
    method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
    body?: Record<string, unknown>;
    timeoutMs?: number;
    signal?: AbortSignal;
}): Promise<Response>;
export declare function callRuntime(env: RuntimeEnv, endpoint: string, body: Record<string, unknown>, timeoutMs?: number): Promise<Response>;
/**
 * Call runtime and parse the JSON response with type safety.
 * Throws ServiceCallError on non-2xx responses.
 */
export declare function callRuntimeJson<T>(env: RuntimeEnv, endpoint: string, body: Record<string, unknown>, timeoutMs?: number): Promise<T>;
export {};
//# sourceMappingURL=runtime-request-handler.d.ts.map