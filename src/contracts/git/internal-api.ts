export type {
  TakosumiActorContext as TakosActorContext,
} from "takosumi-contract/internal/rpc";

export interface GitRepositorySummary {
  id: string;
  name: string;
  ownerSpaceId: string;
  defaultBranch: string;
}

export interface GitRefSummary {
  name: string;
  target: string;
}

export interface GitRepositoryDetail extends GitRepositorySummary {
  refs: GitRefSummary[];
  createdAt: string;
  updatedAt: string;
}

export type GitPullRequestStatus = "open" | "closed" | "merged";

export type GitPullRequestReviewStatus =
  | "commented"
  | "approved"
  | "changes_requested";

export interface GitPullRequestSummary {
  id: string;
  repositoryId: string;
  number: number;
  title: string;
  description?: string;
  headBranch: string;
  baseBranch: string;
  status: GitPullRequestStatus;
  authorAccountId?: string;
  runId?: string;
  mergedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface GitPullRequestComment {
  id: string;
  pullRequestId: string;
  authorAccountId?: string;
  body: string;
  path?: string;
  line?: number;
  createdAt: string;
}

export interface GitPullRequestReview {
  id: string;
  pullRequestId: string;
  reviewerAccountId?: string;
  status: GitPullRequestReviewStatus;
  body?: string;
  analysis?: string;
  createdAt: string;
}

export interface GitPullRequestDetail extends GitPullRequestSummary {
  comments: GitPullRequestComment[];
  reviews: GitPullRequestReview[];
}

export interface GitCreateRepositoryRequest {
  id: string;
  name: string;
  ownerSpaceId: string;
  defaultBranch?: string;
  refs?: GitRefSummary[] | Record<string, string>;
  initialization?: {
    mode?: "default" | "bare";
  };
}

export interface GitUpdateRepositoryRequest {
  name?: string;
  ownerSpaceId?: string;
  defaultBranch?: string;
  refs?: GitRefSummary[] | Record<string, string>;
}

export interface GitImportExternalRepositoryRequest
  extends GitCreateRepositoryRequest {
  remoteUrl: string;
  authHeader?: string | null;
}

export interface GitImportExternalRepositoryResponse {
  repository: GitRepositoryDetail;
  remoteUrl: string;
  defaultBranch: string;
  branchCount: number;
  tagCount: number;
  commitCount: number;
}

export interface GitFetchExternalRepositoryRequest {
  remoteUrl: string;
  authHeader?: string | null;
}

export interface GitFetchExternalRepositoryResponse {
  repositoryId: string;
  remoteUrl: string;
  defaultBranch: string;
  branchCount: number;
  tagCount: number;
  commitCount: number;
  newCommits: number;
  updatedBranches: string[];
  newTags: string[];
  refs: GitRefSummary[];
}

export interface GitTreeEntrySummary {
  path: string;
  name: string;
  objectId: string;
  mode: string;
  type: "blob" | "tree" | "commit" | string;
  size?: number;
}

export interface GitReadTreeResponse {
  repositoryId: string;
  sourceRef: string;
  resolvedCommit: string;
  path: string;
  entries: GitTreeEntrySummary[];
}

export interface GitReadBlobResponse {
  repositoryId: string;
  sourceRef: string;
  resolvedCommit: string;
  path: string;
  objectId: string;
  size: number;
  encoding: "utf-8" | "base64";
  content: string;
}

export interface GitCommitSummary {
  sha: string;
  tree: string;
  parents: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string;
  committerName: string;
  committerEmail: string;
  committerDate: string;
  message: string;
}

export interface GitListCommitsResponse {
  repositoryId: string;
  sourceRef: string;
  resolvedCommit: string;
  commits: GitCommitSummary[];
}

export interface GitReadCommitResponse {
  repositoryId: string;
  sourceRef: string;
  resolvedCommit: string;
  commit: GitCommitSummary;
}

export interface GitListRefsResponse {
  repositoryId: string;
  refs: GitRefSummary[];
}

export interface GitCompareFileSummary {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | string;
  oldPath?: string;
}

export interface GitCompareResponse {
  repositoryId: string;
  baseRef: string;
  headRef: string;
  baseCommit: string;
  headCommit: string;
  mergeBase?: string;
  aheadBy: number;
  behindBy: number;
  files: GitCompareFileSummary[];
}

export interface GitPullRequestDiffLine {
  type: "context" | "addition" | "deletion";
  content: string;
  oldLine?: number;
  newLine?: number;
}

export interface GitPullRequestDiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: GitPullRequestDiffLine[];
}

export interface GitPullRequestDiffFile extends GitCompareFileSummary {
  additions: number;
  deletions: number;
  hunks: GitPullRequestDiffHunk[];
}

export interface GitPullRequestDiffResponse {
  repositoryId: string;
  pullRequestNumber: number;
  baseRef: string;
  headRef: string;
  baseCommit: string;
  headCommit: string;
  files: GitPullRequestDiffFile[];
  stats: {
    totalAdditions: number;
    totalDeletions: number;
    filesChanged: number;
  };
}

export interface GitCreatePullRequestRequest {
  title: string;
  description?: string;
  headBranch: string;
  baseBranch: string;
  runId?: string;
}

export interface GitUpdatePullRequestRequest {
  title?: string;
  description?: string;
  status?: GitPullRequestStatus;
}

export interface GitCreatePullRequestCommentRequest {
  body: string;
  path?: string;
  line?: number;
}

export interface GitCreatePullRequestReviewRequest {
  status: GitPullRequestReviewStatus;
  body?: string;
  analysis?: string;
}

export interface GitMergePullRequestRequest {
  mergeMethod?: "ff-only";
  expectedHead?: string;
}

export interface GitMergePullRequestResponse {
  merged: true;
  repositoryId: string;
  pullRequestNumber: number;
  method: "ff-only";
  baseBranch: string;
  headBranch: string;
  baseCommit: string;
  headCommit: string;
  mergedAt: string;
  pullRequest: GitPullRequestDetail;
}

export interface GitResolveSourceRequest {
  repositoryId: string;
  sourceRef: string;
}

export interface GitResolveSourceResponse {
  repositoryId: string;
  sourceRef: string;
  resolvedCommit: string;
  resolvedRef?: string;
}

export interface GitSourceSnapshotRequest {
  repositoryId: string;
  sourceRef: string;
  path?: string;
  manifestPath?: string;
}

export interface GitSourceSnapshotFile {
  path: string;
  objectId: string;
  mode: string;
  type: string;
  size: number;
}

export interface GitSourceSnapshotResponse {
  kind: "git";
  repositoryId: string;
  sourceRef: string;
  resolvedRef?: string;
  commitSha: string;
  digest: string;
  path: string;
  manifestPath: string;
  manifest?: {
    path: string;
    objectId: string;
    digest: string;
    content: string;
  };
  files: GitSourceSnapshotFile[];
  capturedAt: string;
}

export const TAKOS_GIT_INTERNAL_PATHS = {
  repositories: "/internal/repositories",
  importExternalRepository: "/internal/repositories/import-external",
  repository: (repositoryId: string): string =>
    `/internal/repositories/${encodeURIComponent(repositoryId)}`,
  fetchExternalRepository: (repositoryId: string): string =>
    `/internal/repositories/${encodeURIComponent(repositoryId)}/fetch-external`,
  repositoryRefs: (repositoryId: string): string =>
    `/internal/repositories/${encodeURIComponent(repositoryId)}/refs`,
  repositoryBranches: (repositoryId: string): string =>
    `/internal/repositories/${encodeURIComponent(repositoryId)}/branches`,
  repositoryTags: (repositoryId: string): string =>
    `/internal/repositories/${encodeURIComponent(repositoryId)}/tags`,
  repositoryTree: (repositoryId: string): string =>
    `/internal/repositories/${encodeURIComponent(repositoryId)}/tree`,
  repositoryBlob: (repositoryId: string): string =>
    `/internal/repositories/${encodeURIComponent(repositoryId)}/blob`,
  repositoryCommits: (repositoryId: string): string =>
    `/internal/repositories/${encodeURIComponent(repositoryId)}/commits`,
  repositoryCommit: (repositoryId: string, commitish: string): string =>
    `/internal/repositories/${encodeURIComponent(repositoryId)}/commits/${
      encodeURIComponent(commitish)
    }`,
  repositoryCompare: (repositoryId: string): string =>
    `/internal/repositories/${encodeURIComponent(repositoryId)}/compare`,
  objects: "/internal/objects",
  object: (repositoryId: string, objectId: string): string =>
    `/internal/objects/${encodeURIComponent(repositoryId)}/${
      encodeURIComponent(objectId)
    }`,
  rawObject: (repositoryId: string, objectId: string): string =>
    `/internal/objects/${encodeURIComponent(repositoryId)}/${
      encodeURIComponent(objectId)
    }/raw`,
  pullRequests: (repositoryId: string): string =>
    `/internal/repositories/${encodeURIComponent(repositoryId)}/pull-requests`,
  pullRequest: (repositoryId: string, number: number): string =>
    `/internal/repositories/${encodeURIComponent(repositoryId)}/pull-requests/${
      encodeURIComponent(String(number))
    }`,
  pullRequestDiff: (repositoryId: string, number: number): string =>
    `/internal/repositories/${encodeURIComponent(repositoryId)}/pull-requests/${
      encodeURIComponent(String(number))
    }/diff`,
  pullRequestComments: (repositoryId: string, number: number): string =>
    `/internal/repositories/${encodeURIComponent(repositoryId)}/pull-requests/${
      encodeURIComponent(String(number))
    }/comments`,
  pullRequestReviews: (repositoryId: string, number: number): string =>
    `/internal/repositories/${encodeURIComponent(repositoryId)}/pull-requests/${
      encodeURIComponent(String(number))
    }/reviews`,
  pullRequestMerge: (repositoryId: string, number: number): string =>
    `/internal/repositories/${encodeURIComponent(repositoryId)}/pull-requests/${
      encodeURIComponent(String(number))
    }/merge`,
  resolveSource: "/internal/source/resolve",
  sourceSnapshot: "/internal/source/snapshot",
} as const;

export const TAKOS_GIT_CAPABILITIES = {
  repoRead: "git.repo.read",
  repoWrite: "git.repo.write",
  repoImport: "git.repo.import",
  objectRead: "git.object.read",
  refResolve: "git.ref.resolve",
  sourceSnapshot: "git.source.snapshot",
  prRead: "git.pr.read",
  prWrite: "git.pr.write",
  prMerge: "git.pr.merge",
} as const;
