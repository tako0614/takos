import type { D1Database } from '../../../shared/types/bindings.ts';
export type TakosAccessTokenValidation = {
    userId: string;
    scopes: string[];
    tokenKind: 'personal' | 'managed_builtin';
};
export declare function validateTakosAccessToken(db: D1Database, token: string, requiredScopes?: string[]): Promise<TakosAccessTokenValidation | null>;
export declare function validateTakosPersonalAccessToken(db: D1Database, token: string, requiredScopes?: string[]): Promise<TakosAccessTokenValidation | null>;
export declare function issueTakosAccessToken(): Promise<{
    token: string;
    tokenHash: string;
    tokenPrefix: string;
}>;
//# sourceMappingURL=takos-access-tokens.d.ts.map