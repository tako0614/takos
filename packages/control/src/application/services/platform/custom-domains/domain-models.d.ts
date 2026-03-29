import type { SpaceRole } from '../../../../shared/types';
export declare const MAX_CUSTOM_DOMAINS_PER_SERVICE = 20;
export declare const CUSTOM_DOMAIN_WRITE_ROLES: SpaceRole[];
export declare const SSL_TERMINAL_FAILURE_STATUSES: string[];
export type DomainStatus = 'pending' | 'verifying' | 'dns_verified' | 'ssl_pending' | 'ssl_failed' | 'active' | 'failed';
export interface DnsInstruction {
    type: 'CNAME' | 'TXT';
    name: string;
    value: string;
    description: string;
}
export interface AddCustomDomainBody {
    id: string;
    domain: string;
    status: 'pending';
    verification_method: 'cname' | 'txt';
    verification_token: string;
    instructions: {
        step1: DnsInstruction;
        step2: DnsInstruction;
    };
}
export interface AddCustomDomainResult {
    status: number;
    body: AddCustomDomainBody;
}
export interface VerifyDomainSuccessBody {
    status: DomainStatus;
    message: string;
    dns_verified?: boolean;
    ssl_verified?: boolean;
    verified_at?: string;
    ssl_status?: string;
    verified?: boolean;
}
export interface VerifyDomainErrorBody {
    error: string;
}
export interface VerifyCustomDomainResult {
    status: number;
    body: VerifyDomainSuccessBody | VerifyDomainErrorBody;
}
export interface ServiceInfo {
    id: string;
    space_id: string;
    service_type: 'app' | 'service';
    status: string;
    hostname: string | null;
    route_ref: string | null;
    slug: string | null;
}
export declare class CustomDomainError extends Error {
    status: number;
    details?: string;
    constructor(message: string, status: number, details?: string);
}
//# sourceMappingURL=domain-models.d.ts.map