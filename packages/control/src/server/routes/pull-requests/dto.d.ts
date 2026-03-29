import type { PullRequestStatus, AuthorType } from '../../../shared/types';
import type { SelectOf } from '../../../shared/types/drizzle-utils';
import type { pullRequests } from '../../../infra/db/schema';
import { type Database } from '../../../infra/db';
import type { D1Database } from '../../../shared/types/bindings.ts';
type PrRecord = SelectOf<typeof pullRequests>;
export type UserLiteDto = {
    id: string;
    name: string;
    avatar_url: string | null;
};
export type PullRequestDto = {
    id: string;
    repo_id: string;
    number: number;
    title: string;
    description: string | null;
    status: 'open' | 'merged' | 'closed';
    author: UserLiteDto;
    source_branch: string;
    target_branch: string;
    commits_count: number;
    comments_count: number;
    reviews_count: number;
    is_mergeable: boolean;
    created_at: string;
    updated_at: string;
    merged_at: string | null;
    closed_at: string | null;
};
export type PullRequestReviewDto = {
    id: string;
    pr_id: string;
    reviewer_type: 'user' | 'ai';
    reviewer_id: string | null;
    status: 'approved' | 'changes_requested' | 'commented';
    body: string | null;
    analysis: string | null;
    created_at: string;
    author: UserLiteDto;
};
export type PullRequestCommentDto = {
    id: string;
    pr_id: string;
    author_type: 'user' | 'ai';
    author_id: string | null;
    body: string;
    path: string | null;
    line: number | null;
    created_at: string;
    author: UserLiteDto;
};
export declare const AI_USER_LITE: UserLiteDto;
export declare const AGENT_USER_LITE: UserLiteDto;
export declare const UNKNOWN_USER_LITE: UserLiteDto;
export type PullRequestRecord = {
    id: string;
    repoId: string;
    number: number;
    title: string;
    description: string | null;
    headBranch: string;
    baseBranch: string;
    status: PullRequestStatus | string;
    authorType: AuthorType | string;
    authorId: string | null;
    mergedAt: string | Date | null;
    createdAt: string | Date;
    updatedAt: string | Date;
};
type UserRecordLite = {
    id: string;
    name: string;
    picture: string | null;
};
export declare function toUserLiteDto(user: UserRecordLite): UserLiteDto;
export declare function buildUserLiteMap(dbOrD1: Database | D1Database, userIds: string[]): Promise<Map<string, UserLiteDto>>;
export declare function resolveActorLite(options: {
    actorType: string | null | undefined;
    actorId: string | null | undefined;
    userMap: Map<string, UserLiteDto>;
}): UserLiteDto;
export declare function toPullRequestRecord(record: PrRecord): PullRequestRecord;
export declare function toPullRequestDto(pullRequest: PullRequestRecord, options: {
    author: UserLiteDto;
    commitsCount: number;
    commentsCount: number;
    reviewsCount: number;
    isMergeable: boolean;
}): PullRequestDto;
export declare function buildPullRequestDtoFull(db: Database, pullRequest: PullRequestRecord): Promise<PullRequestDto>;
export {};
//# sourceMappingURL=dto.d.ts.map