import type { LocalBinding } from './runtime-types.ts';
export declare function createForwardingBinding(baseUrl: string): LocalBinding;
export declare function ensureTrailingSlash(baseUrl: string): URL;
export declare function buildServiceRequest(baseUrl: string, path: string, init?: RequestInit): Request;
export declare function forwardRequestToBase(baseUrl: string, request: Request, pathOverride?: string): Promise<Response>;
export declare function jsonResponse(body: unknown, status?: number): Response;
export declare function readBearerToken(value: string | null): string | null;
export declare function resolveServiceUrl(envVarName: string, defaultPort: number): string;
export declare function resolveOptionalServiceForwardUrl(envVarName: string, defaultPort: number): string | null;
//# sourceMappingURL=runtime-http.d.ts.map