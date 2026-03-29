import type { Env } from '../../../../shared/types';
import type { AddCustomDomainResult } from './domain-models';
export declare function listCustomDomains(env: Env, serviceId: string, userId: string): Promise<{
    domains: {
        id: string;
        service_id: string;
        domain: string;
        status: string;
        verification_token: string;
        verification_host: string;
        verification_method: string;
        ssl_status: string | null;
        verified_at: string | null;
        created_at: string;
        updated_at: string;
    }[];
}>;
export declare function addCustomDomain(env: Env, serviceId: string, userId: string, body: {
    domain?: string;
    verification_method?: 'cname' | 'txt';
} | null): Promise<AddCustomDomainResult>;
export declare function deleteCustomDomain(env: Env, serviceId: string, userId: string, domainId: string): Promise<{
    success: boolean;
    warnings: string[];
    message: string;
} | {
    success: boolean;
    warnings?: undefined;
    message?: undefined;
}>;
//# sourceMappingURL=domain-crud.d.ts.map