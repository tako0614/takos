/**
 * Generic service-call error handling for non-Cloudflare upstream APIs.
 *
 * Cloudflare-specific clients (WfpClient, CloudflareApiClient) use their own
 * error model (CloudflareAPIError / classifyAPIError in wfp/client.ts) because
 * they need rate-limit, retry-after, and isRetryable metadata that is specific
 * to the Cloudflare Management API. Merging the two would either bloat the
 * generic model or lose Cloudflare-specific context, so they are intentionally
 * kept separate.
 */
import { AppError } from 'takos-common/errors';
export declare class ServiceCallError extends AppError {
    readonly upstreamStatus: number;
    readonly upstreamCode?: string;
    readonly upstreamBody?: string;
    readonly serviceName: string;
    constructor(opts: {
        serviceName: string;
        upstreamStatus: number;
        upstreamCode?: string;
        upstreamBody?: string;
        message?: string;
    });
}
export declare function parseServiceResponse<T>(res: Response, serviceName: string): Promise<T>;
//# sourceMappingURL=service-client.d.ts.map