import { type Database } from '../../../infra/db';
import type { PullRequestStatus } from '../../../shared/types';
import { type RepoDiffPayload } from './diff';
import { type PullRequestDto, type PullRequestRecord } from './dto';
import type { AuthenticatedRouteEnv } from '../route-auth';
export type PullRequestDetail = {
    pullRequest: PullRequestDto;
    diff: RepoDiffPayload | null;
    diffStats: RepoDiffPayload['stats'] | null;
    reviewCount: number;
    commentCount: number;
};
export declare function getNextPullRequestNumber(d1: AuthenticatedRouteEnv['Bindings']['DB'], repoId: string): Promise<number>;
export declare function findPullRequest(d1: AuthenticatedRouteEnv['Bindings']['DB'], repoId: string, prNumber: number): Promise<{
    db: Database;
    pullRequest: PullRequestRecord;
} | null>;
export declare function buildPullRequestList(env: AuthenticatedRouteEnv['Bindings'], repoId: string, status: PullRequestStatus | undefined, limit: number, offset: number): Promise<PullRequestDto[]>;
export declare function buildPullRequestDetail(env: AuthenticatedRouteEnv['Bindings'], repoId: string, db: Database, pullRequest: PullRequestRecord): Promise<PullRequestDetail>;
//# sourceMappingURL=read-model.d.ts.map