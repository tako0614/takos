export declare function generateVerificationToken(): string;
export declare function generateDomainId(): string;
export declare function isValidDomain(domain: string): boolean;
export declare function normalizeDomain(domain: string): string;
export declare const RESERVED_SUBDOMAINS: Set<string>;
export declare function isReservedSubdomain(subdomain: string): boolean;
export declare function hasReservedSubdomain(domain: string): boolean;
export declare function isDomainReserved(domain: string, tenantBaseDomain: string): boolean;
export declare const RESERVED_USERNAMES: Set<string>;
export declare function isReservedUsername(username: string): boolean;
export declare function validateUsername(username: string): string | null;
//# sourceMappingURL=domain-validation.d.ts.map