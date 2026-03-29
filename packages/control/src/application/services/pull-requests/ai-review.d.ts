import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Env, PullRequestComment, PullRequestReview } from '../../../shared/types';
export type AiReviewResult = {
    review: PullRequestReview;
    comments: PullRequestComment[];
    model: string;
    provider: string;
};
type PullRequestRecord = {
    id: string;
    number: number;
    title: string;
    description: string | null;
    headBranch: string;
    baseBranch: string;
};
export declare class AiReviewError extends Error {
    status: ContentfulStatusCode;
    details?: string;
    constructor(message: string, status?: ContentfulStatusCode, details?: string);
}
export declare function buildPRDiffText(env: Env, repoId: string, baseRef: string, headRef: string): Promise<{
    diffText: string;
    totalFiles: number;
    skipped: string[];
}>;
export declare function runAiReview(options: {
    env: Env;
    repoId: string;
    pullRequest: PullRequestRecord;
    spaceId: string;
}): Promise<AiReviewResult>;
export {};
//# sourceMappingURL=ai-review.d.ts.map