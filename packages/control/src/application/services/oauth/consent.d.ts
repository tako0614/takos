import type { D1Database } from '../../../shared/types/bindings.ts';
import type { OAuthConsent } from '../../../shared/types/oauth';
export declare function getConsent(dbBinding: D1Database, userId: string, clientId: string): Promise<OAuthConsent | null>;
export declare function hasFullConsent(dbBinding: D1Database, userId: string, clientId: string, requestedScopes: string[]): Promise<boolean>;
export declare function getNewScopes(dbBinding: D1Database, userId: string, clientId: string, requestedScopes: string[]): Promise<string[]>;
export declare function grantConsent(dbBinding: D1Database, userId: string, clientId: string, scopes: string[]): Promise<OAuthConsent>;
export declare function revokeConsent(dbBinding: D1Database, userId: string, clientId: string): Promise<boolean>;
export declare function removeConsentScopes(dbBinding: D1Database, userId: string, clientId: string, scopesToRemove: string[]): Promise<boolean>;
export declare function getUserConsents(dbBinding: D1Database, userId: string): Promise<OAuthConsent[]>;
export interface ConsentWithClient extends OAuthConsent {
    client_name?: string;
    client_logo?: string;
    client_uri?: string;
}
export declare function getUserConsentsWithClients(dbBinding: D1Database, userId: string): Promise<ConsentWithClient[]>;
//# sourceMappingURL=consent.d.ts.map