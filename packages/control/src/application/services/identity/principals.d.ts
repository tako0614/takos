/**
 * principals.ts — thin delegation layer after the User/Workspace/Principal → Account migration.
 *
 * The dedicated `principal` table has been removed. All principal identity is
 * now carried by the `Account` model directly. This file keeps the existing
 * call-sites compiling by delegating to the `account` table.
 */
import type { D1Database } from '../../../shared/types/bindings.ts';
import type { Principal } from '../../../shared/types';
/**
 * Previously returned a separate principalId; now returns the account id directly.
 */
export declare function resolveUserPrincipalId(db: D1Database, userId: string): Promise<string | null>;
/**
 * Resolve the principal/actor id for a given actor. Returns the account id
 * directly since the principal table no longer exists.
 */
export declare function resolveActorPrincipalId(db: D1Database, actorId: string): Promise<string | null>;
export declare function getPrincipalById(db: D1Database, principalId: string): Promise<Principal | null>;
//# sourceMappingURL=principals.d.ts.map