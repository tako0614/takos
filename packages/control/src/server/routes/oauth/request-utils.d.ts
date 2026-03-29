import type { Env } from '../../../shared/types';
import { logOAuthEvent } from '../../../application/services/oauth/audit';
/** Minimal context shape accepted by tryLogOAuthEvent — works with any Hono env that includes Env bindings. */
type MinimalOAuthContext = {
    env: Env;
    req: {
        header: (name: string) => string | undefined;
    };
};
export { escapeHtml } from '../auth/html';
export declare function isValidLogoUrl(url: string | undefined | null): boolean;
/**
 * Extract a single string value from a parsed form body field.
 * Handles both single values and arrays (takes the first element).
 */
export type FormValue = string | File;
export type FormBody = Record<string, FormValue | FormValue[]>;
export declare function getBodyValue(value: FormValue | FormValue[] | undefined): string | undefined;
/** DB user record shape returned by findUnique */
export interface DbUserRecord {
    id: string;
    email: string | null;
    name: string;
    slug: string;
    bio: string | null;
    picture: string | null;
    setupCompleted: boolean;
    createdAt: string | Date;
    updatedAt: string | Date;
}
/** Map a DB user record to the legacy snake_case shape used in OAuth routes */
export declare function mapDbUser(u: DbUserRecord): {
    id: string;
    email: string | null;
    name: string;
    username: string;
    bio: string | null;
    picture: string | null;
    setup_completed: boolean;
    created_at: string | Date;
    updated_at: string | Date;
};
export declare function tryLogOAuthEvent(c: MinimalOAuthContext, input: Parameters<typeof logOAuthEvent>[1]): Promise<void>;
//# sourceMappingURL=request-utils.d.ts.map