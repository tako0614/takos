import type { Env } from '../../../../shared/types';
import type { VerifyCustomDomainResult } from './domain-models';
export declare function verifyCustomDomain(env: Env, serviceId: string, userId: string, domainId: string): Promise<VerifyCustomDomainResult>;
export declare function getCustomDomainDetails(env: Env, serviceId: string, userId: string, domainId: string): Promise<{
    id: string;
    domain: string;
    status: string;
    verification_method: string;
    ssl_status: string | null;
    verified_at: string | null;
    created_at: string;
    instructions: {
        cname_target: string;
        verification_record: {
            type: string;
            name: string;
            value: string;
        };
    } | undefined;
}>;
export declare function refreshSslStatus(env: Env, serviceId: string, userId: string, domainId: string): Promise<{
    status: string;
    ssl_status: string | null;
    hostname_status?: undefined;
} | {
    status: string;
    ssl_status: string;
    hostname_status: string;
}>;
//# sourceMappingURL=domain-verification.d.ts.map