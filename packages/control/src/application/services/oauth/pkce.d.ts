import type { CodeChallengeMethod } from '../../../shared/types/oauth';
export declare function generateCodeVerifier(): string;
export declare function generateCodeChallenge(verifier: string, method?: CodeChallengeMethod): Promise<string>;
export declare function verifyCodeChallenge(codeVerifier: string, codeChallenge: string, method?: CodeChallengeMethod): Promise<boolean>;
export declare function isValidCodeVerifier(verifier: string): boolean;
export declare function isValidCodeChallenge(challenge: string): boolean;
export declare function generateRandomString(length: number): string;
export declare function generateId(): string;
//# sourceMappingURL=pkce.d.ts.map