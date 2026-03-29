import type { D1Database } from '../../../shared/types/bindings.ts';
import type { OAuthClient, OAuthClientStatus, ClientRegistrationRequest, ClientRegistrationResponse } from '../../../shared/types/oauth';
export declare function getClientById(dbBinding: D1Database, clientId: string): Promise<OAuthClient | null>;
export declare function getClientByInternalId(dbBinding: D1Database, id: string): Promise<OAuthClient | null>;
export declare function getClientsByOwner(dbBinding: D1Database, ownerId: string): Promise<OAuthClient[]>;
export declare function createClient(dbBinding: D1Database, request: ClientRegistrationRequest, ownerId?: string): Promise<ClientRegistrationResponse>;
export declare function updateClient(dbBinding: D1Database, clientId: string, updates: Partial<ClientRegistrationRequest>): Promise<OAuthClient | null>;
export declare function deleteClient(dbBinding: D1Database, clientId: string): Promise<boolean>;
export declare function updateClientStatus(dbBinding: D1Database, clientId: string, status: OAuthClientStatus): Promise<boolean>;
export declare function validateClientCredentials(dbBinding: D1Database, clientId: string, clientSecret?: string): Promise<{
    valid: boolean;
    client: OAuthClient | null;
    error?: string;
}>;
export declare function validateRegistrationToken(dbBinding: D1Database, clientId: string, token: string): Promise<boolean>;
export declare function validateRedirectUri(client: OAuthClient, redirectUri: string): boolean;
export declare function validateRedirectUris(uris: string[]): void;
export declare function supportsGrantType(client: OAuthClient, grantType: string): boolean;
export declare function getClientAllowedScopes(client: OAuthClient): string[];
export declare function getClientRedirectUris(client: OAuthClient): string[];
//# sourceMappingURL=client.d.ts.map