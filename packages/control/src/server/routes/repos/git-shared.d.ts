import type { Context } from 'hono';
import type { AuthenticatedRouteEnv } from '../route-auth';
import { type RepoBucketBinding } from './routes';
import type * as gitStore from '../../../application/services/git-smart';
export type RepoContext = Context<AuthenticatedRouteEnv>;
export declare const WRITE_ROLES: readonly ["owner", "admin", "editor"];
export declare function requireBucket(c: RepoContext): RepoBucketBinding;
export declare function sigTimestampToIso(timestamp: number | string | undefined): string;
export declare function getCommitSha(commit: {
    sha?: string;
    oid?: string;
}): string;
export declare function getCommitParents(commit: {
    parents?: string[];
}): string[];
export declare function warnDegradedCommit(resolvedCommit: Extract<gitStore.ResolveReadableCommitResult, {
    ok: true;
}>, repoId: string, ref: string): void;
export declare function throwIfTreeFlattenLimit(err: unknown, operation: string): void;
//# sourceMappingURL=git-shared.d.ts.map