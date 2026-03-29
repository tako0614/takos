import type { Env } from '../../../../shared/types';
export declare function createCloudflareCustomHostname(env: Env, domain: string): Promise<{
    success: boolean;
    customHostnameId?: string;
    error?: string;
}>;
export declare function deleteCloudflareCustomHostname(env: Env, customHostnameId: string): Promise<void>;
export declare function getCloudflareCustomHostnameStatus(env: Env, customHostnameId: string): Promise<{
    status: string;
    sslStatus: string;
} | null>;
//# sourceMappingURL=cloudflare.d.ts.map