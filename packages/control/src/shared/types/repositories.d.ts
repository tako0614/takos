export type RepositoryVisibility = 'public' | 'private';
export interface Repository {
    id: string;
    space_id: string;
    name: string;
    description: string | null;
    visibility: RepositoryVisibility;
    default_branch: string;
    forked_from_id: string | null;
    stars: number;
    forks: number;
    git_enabled: boolean;
    created_at: string;
    updated_at: string;
}
export type PullRequestStatus = 'open' | 'merged' | 'closed';
export type AuthorType = 'user' | 'agent';
export type PullRequestCommentAuthorType = 'user' | 'ai';
export interface PullRequest {
    id: string;
    repo_id: string;
    number: number;
    title: string;
    description: string | null;
    head_branch: string;
    base_branch: string;
    status: PullRequestStatus;
    author_type: AuthorType;
    author_id: string | null;
    run_id: string | null;
    merged_at: string | null;
    created_at: string;
    updated_at: string;
}
export type ReviewStatus = 'approved' | 'changes_requested' | 'commented';
export type ReviewerType = 'user' | 'ai';
export interface PullRequestReview {
    id: string;
    pr_id: string;
    reviewer_type: ReviewerType;
    reviewer_id: string | null;
    status: ReviewStatus;
    body: string | null;
    analysis: string | null;
    created_at: string;
}
export interface PullRequestComment {
    id: string;
    pr_id: string;
    author_type: PullRequestCommentAuthorType;
    author_id: string | null;
    content: string;
    file_path: string | null;
    line_number: number | null;
    created_at: string;
}
//# sourceMappingURL=repositories.d.ts.map