import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
export declare function generateUniqueUserId(db: SqlDatabaseBinding): Promise<string>;
type GoogleOAuthProfile = {
    id: string;
    email: string;
    name: string;
    picture: string;
    verified_email: boolean;
};
type ProvisionedGoogleOAuthUser = {
    id: string;
    email: string;
    name: string;
    username: string;
    bio: null;
    picture: string;
    setup_completed: boolean;
    created_at: string;
    updated_at: string;
};
export declare function provisionGoogleOAuthUser(dbBinding: SqlDatabaseBinding, profile: GoogleOAuthProfile): Promise<ProvisionedGoogleOAuthUser>;
export declare function sanitizeReturnTo(value: string | null | undefined): string;
export declare function validateCliCallbackUrl(callbackUrl: string): {
    valid: boolean;
    error?: string;
    sanitizedUrl?: string;
};
export {};
//# sourceMappingURL=provisioning.d.ts.map