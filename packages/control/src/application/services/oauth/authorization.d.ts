import type { D1Database } from '../../../shared/types/bindings.ts';
import type { OAuthAuthorizationCode, OAuthClient, AuthorizationRequest, CodeChallengeMethod } from '../../../shared/types/oauth';
export interface AuthorizationValidationResult {
    valid: boolean;
    client?: OAuthClient;
    error?: string;
    errorDescription?: string;
    redirectUri?: string;
}
export declare function validateAuthorizationRequest(dbBinding: D1Database, request: Partial<AuthorizationRequest>): Promise<AuthorizationValidationResult>;
export declare function generateAuthorizationCode(dbBinding: D1Database, params: {
    clientId: string;
    userId: string;
    redirectUri: string;
    scope: string;
    codeChallenge: string;
    codeChallengeMethod: CodeChallengeMethod;
}): Promise<string>;
export interface CodeExchangeResult {
    valid: boolean;
    code?: OAuthAuthorizationCode;
    error?: string;
    errorDescription?: string;
}
export declare function exchangeAuthorizationCode(dbBinding: D1Database, params: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
}): Promise<CodeExchangeResult>;
export declare function deleteExpiredCodes(dbBinding: D1Database): Promise<number>;
export declare function buildErrorRedirect(redirectUri: string, state: string, error: string, errorDescription?: string): string;
export declare function buildSuccessRedirect(redirectUri: string, state: string, code: string): string;
//# sourceMappingURL=authorization.d.ts.map