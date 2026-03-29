/**
 * MCP Service - Cryptographic Helpers
 *
 * PKCE (Proof Key for Code Exchange) helpers and token encryption/decryption.
 */
export declare function generateCodeVerifier(): string;
export declare function deriveCodeChallenge(verifier: string): Promise<string>;
export declare function generateState(): string;
export declare function saltFor(serverId: string, field: 'access' | 'refresh' | 'verifier'): string;
export declare function encryptToken(token: string, masterSecret: string, salt: string): Promise<string>;
export declare function decryptToken(encryptedJson: string, masterSecret: string, salt: string): Promise<string>;
//# sourceMappingURL=crypto.d.ts.map