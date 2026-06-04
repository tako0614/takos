import { hc } from "hono/client";
import type { ClientResponse } from "hono/client";
import type { ApiRoutes } from "takos-api-contract/rpc-types";
import { getTranslation, type TranslationKey } from "../i18n.ts";
import { detectLanguage } from "./locale.ts";
import type {
  Branch,
  Commit,
  FileDiff,
  PRComment,
  PRReview,
  PullRequest,
} from "../types/index.ts";
import { withTimeout } from "./withTimeout.ts";

export const rpc = hc<ApiRoutes>("/api");
const DEFAULT_API_TIMEOUT_MS = 15000;

function fallbackMessage(key: TranslationKey): string {
  return getTranslation(detectLanguage(), key);
}

// ---------------------------------------------------------------------------
// rpcPath – type-safe traversal of the Hono RPC proxy for routes that lack
// compile-time types (wildcard `/*` routes, or routes not in the schema).
//
// At runtime, `hc()` returns a Proxy that builds up URL segments from
// property access.  Paths like `/repos/:repoId/tree/:ref/*` work fine at
// runtime but produce no type in Hono's `PathToChain` because `*` is not a
// valid key.  This single helper encapsulates the lone `any` cast so every
// call-site remains fully typed.
// ---------------------------------------------------------------------------

/** Shape of a terminal Hono RPC node that exposes HTTP-method helpers. */
interface RpcEndpoint {
  $get: (
    args: { param?: Record<string, string>; query?: Record<string, string> },
  ) => Promise<ClientResponse<unknown>>;
  $post: (
    args: { param?: Record<string, string>; json?: Record<string, unknown> },
  ) => Promise<ClientResponse<unknown>>;
  $put: (
    args: { param?: Record<string, string>; json?: Record<string, unknown> },
  ) => Promise<ClientResponse<unknown>>;
  $patch: (
    args: { param?: Record<string, string>; json?: Record<string, unknown> },
  ) => Promise<ClientResponse<unknown>>;
  $delete: (
    args: { param?: Record<string, string> },
  ) => Promise<ClientResponse<unknown>>;
}

/**
 * Walk the Hono RPC proxy through arbitrary path segments and return the
 * terminal node typed as {@link RpcEndpoint}.
 *
 * Example:
 * ```ts
 * rpcPath(rpc, 'repos', ':repoId', 'tree', ':ref').$get({ param: { repoId, ref } })
 * ```
 */
export function rpcPath(base: unknown, ...segments: string[]): RpcEndpoint {
  let current = base;
  for (const seg of segments) {
    current = (current as Record<string, unknown>)[seg];
  }
  return current as RpcEndpoint;
}

export class BillingQuotaError extends Error {
  code = "BILLING_QUOTA_EXCEEDED" as const;
  reason: string;
  plan: string;
  constructor(data: { reason?: string; plan?: string }) {
    super(data.reason || fallbackMessage("billingQuotaExceeded"));
    this.reason = data.reason || fallbackMessage("billingQuotaExceeded");
    this.plan = data.plan || "";
  }
}

export interface JsonResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type RpcResponse = ClientResponse<unknown>;

/**
 * Extract a human-readable error message from a parsed error payload.
 *
 * The takos stack produces error bodies in two current shapes:
 *
 *  1. **takos common envelope** – `{ error: { code, message } }`
 *     Emitted by `AppError.toResponse()` for any route that throws an
 *     `AppError` subclass (NotFoundError, BadRequestError, etc.).
 *
 *  2. **Protocol flat error** – `{ error: 'invalid_client',
 *     error_description: 'Client not found' }`
 *     Protocol endpoints may need a flat shape for standards compliance, so
 *     we detect and flatten it here instead of forcing every route onto the
 *     envelope.
 * Returns `null` when no useful message can be extracted so the caller can
 * fall back to a generic default.
 */
function extractErrorMessage(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const record = data as Record<string, unknown>;
  const rawError = record.error;

  // Shape (1): { error: { code, message } }
  if (rawError && typeof rawError === "object") {
    const envelope = rawError as Record<string, unknown>;
    if (typeof envelope.message === "string" && envelope.message.length > 0) {
      return envelope.message;
    }
    if (typeof envelope.code === "string" && envelope.code.length > 0) {
      return envelope.code;
    }
    return null;
  }

  // Shape (2): { error: 'invalid_client', error_description: '...' }
  if (typeof rawError === "string") {
    const description = record.error_description;
    if (typeof description === "string" && description.length > 0) {
      return description;
    }
    if (/^[a-z][a-z0-9_.:-]*$/.test(rawError)) return rawError;
  }

  return null;
}

export async function rpcJson<T>(response: JsonResponseLike): Promise<T> {
  if (!response.ok) {
    const data = await response.json().catch((e) => {
      console.warn("Failed to parse error response JSON:", e);
      return {};
    }) as {
      error?: unknown;
      error_description?: unknown;
      code?: string;
      reason?: string;
      plan?: string;
    };
    const message = extractErrorMessage(data);
    if (response.status === 401) {
      const returnTo =
        `${globalThis.location.pathname}${globalThis.location.search}`;
      globalThis.location.href = `/auth/oidc/login?return_to=${
        encodeURIComponent(returnTo)
      }`;
      throw new Error(message || fallbackMessage("authenticationRequired"));
    }
    if (response.status === 402 && data.code === "BILLING_QUOTA_EXCEEDED") {
      throw new BillingQuotaError(data);
    }
    throw new Error(message || fallbackMessage("requestFailed"));
  }
  return await response.json() as T;
}

export interface ApiJsonOptions {
  timeoutMs?: number;
  init?: RequestInit;
}

export async function apiJson<T>(
  path: string,
  options: ApiJsonOptions = {},
): Promise<T> {
  const { timeoutMs = DEFAULT_API_TIMEOUT_MS, init } = options;
  const response = await withTimeout(
    (signal) => {
      const headers = new Headers(init?.headers);
      if (!headers.has("Accept")) {
        headers.set("Accept", "application/json");
      }
      return fetch(path, {
        ...init,
        headers,
        signal,
      });
    },
    timeoutMs,
    fallbackMessage("requestTimedOut"),
  );
  return await rpcJson<T>(response);
}

// ---------------------------------------------------------------------------
// Typed RPC helpers for routes whose wildcard patterns (`/*`) or missing
// schema entries break hono/client's type inference.
// These use `rpcPath` so route access stays structural at call-sites.
// ---------------------------------------------------------------------------

/** GET /api/repositories/:repoId/tree?ref=... */
export function repoTree(
  repoId: string,
  ref: string,
  query?: Record<string, string>,
): Promise<RpcResponse> {
  return repositoryRead("tree", repoId, ref, query);
}

/** GET /api/repositories/:repoId/blob?ref=... */
export function repoBlob(
  repoId: string,
  ref: string,
  query?: Record<string, string>,
): Promise<RpcResponse> {
  return repositoryRead("blob", repoId, ref, query);
}

/** GET /api/repositories/:repoId/commits */
export async function repoCommits(
  repoId: string,
  ref: string,
  options: { page?: number; limit?: number; path?: string } = {},
): Promise<{ commits: Commit[] }> {
  const limit = options.limit ?? 20;
  const page = Math.max(options.page ?? 1, 1);
  const params = new URLSearchParams({
    ref,
    limit: String(limit),
    offset: String((page - 1) * limit),
  });
  if (options.path) params.set("path", options.path);
  const data = await apiJson<{ commits?: GitCommitSummaryLike[] }>(
    `/api/repositories/${encodeURIComponent(repoId)}/commits?${params}`,
  );
  return {
    commits: (data.commits ?? []).map(toFrontendCommit),
  };
}

/** GET /api/repositories/:repoId/branches */
export async function repoBranches(repoId: string): Promise<{
  branches: Branch[];
}> {
  const [detail, refs] = await Promise.all([
    apiJson<{ defaultBranch?: string }>(
      `/api/repositories/${encodeURIComponent(repoId)}`,
    ),
    apiJson<{ refs?: GitRefSummaryLike[] }>(
      `/api/repositories/${encodeURIComponent(repoId)}/branches`,
    ),
  ]);
  const defaultBranch = detail.defaultBranch ?? "";
  return {
    branches: (refs.refs ?? []).map((ref) =>
      toFrontendBranch(ref, defaultBranch)
    ),
  };
}

/** GET /api/repositories/:repoId/pull-requests */
export async function repoPullRequests(
  repoId: string,
  query?: Record<string, string>,
): Promise<{ pull_requests: PullRequest[] }> {
  const params = new URLSearchParams(query ?? {});
  const suffix = params.size > 0 ? `?${params.toString()}` : "";
  const data = await apiJson<{ pullRequests?: GitPullRequestLike[] }>(
    `/api/repositories/${encodeURIComponent(repoId)}/pull-requests${suffix}`,
  );
  const mergeability = await loadPullRequestMergeability(
    repoId,
    data.pullRequests ?? [],
  );
  return {
    pull_requests: (data.pullRequests ?? []).map((pr) =>
      toFrontendPullRequest(pr, mergeability.get(pr.id))
    ),
  };
}

/** GET /api/repositories/:repoId/pull-requests/:number/comments */
export async function repoPullRequestComments(
  repoId: string,
  prNumber: number | string,
): Promise<{ comments: PRComment[] }> {
  const data = await apiJson<{ comments?: GitPullRequestCommentLike[] }>(
    `/api/repositories/${encodeURIComponent(repoId)}/pull-requests/${
      encodeURIComponent(String(prNumber))
    }/comments`,
  );
  return {
    comments: (data.comments ?? []).map(toFrontendPullRequestComment),
  };
}

/** GET /api/repositories/:repoId/pull-requests/:number/diff */
export async function repoPullRequestDiff(
  repoId: string,
  prNumber: number | string,
): Promise<{ files: FileDiff[] }> {
  const data = await apiJson<{ files?: GitPullRequestDiffFileLike[] }>(
    `/api/repositories/${encodeURIComponent(repoId)}/pull-requests/${
      encodeURIComponent(String(prNumber))
    }/diff`,
  );
  return {
    files: (data.files ?? []).map(toFrontendPullRequestDiffFile),
  };
}

/** PATCH /api/repositories/:repoId/pull-requests/:number */
export async function repoClosePullRequest(
  repoId: string,
  prNumber: number | string,
): Promise<{ pull_request?: PullRequest }> {
  const data = await apiJson<{ pullRequest?: GitPullRequestDetailLike }>(
    `/api/repositories/${encodeURIComponent(repoId)}/pull-requests/${
      encodeURIComponent(String(prNumber))
    }`,
    {
      init: {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "closed" }),
      },
    },
  );
  return {
    pull_request: data.pullRequest
      ? toFrontendPullRequest(data.pullRequest)
      : undefined,
  };
}

/** POST /api/repositories/:repoId/pull-requests/:number/comments */
export async function repoCreatePullRequestComment(
  repoId: string,
  prNumber: number | string,
  input: { body: string; path?: string | null; line?: number | null },
): Promise<{ comment: PRComment }> {
  const data = await apiJson<{ comment?: GitPullRequestCommentLike }>(
    `/api/repositories/${encodeURIComponent(repoId)}/pull-requests/${
      encodeURIComponent(String(prNumber))
    }/comments`,
    {
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          body: input.body,
          path: input.path ?? undefined,
          line: input.line ?? undefined,
        }),
      },
    },
  );
  if (!data.comment) {
    throw new Error("Pull request comment response is missing comment");
  }
  return { comment: toFrontendPullRequestComment(data.comment) };
}

/** GET /api/repositories/:repoId/pull-requests/:number/reviews */
export async function repoPullRequestReviews(
  repoId: string,
  prNumber: number | string,
): Promise<{ reviews: PRReview[] }> {
  const data = await apiJson<{ reviews?: GitPullRequestReviewLike[] }>(
    `/api/repositories/${encodeURIComponent(repoId)}/pull-requests/${
      encodeURIComponent(String(prNumber))
    }/reviews`,
  );
  return {
    reviews: (data.reviews ?? []).map(toFrontendPullRequestReview),
  };
}

/** POST /api/repositories/:repoId/pull-requests/:number/reviews */
export async function repoCreatePullRequestReview(
  repoId: string,
  prNumber: number | string,
  input: { status: PRReview["status"]; body?: string },
): Promise<{ review: PRReview }> {
  const data = await apiJson<{ review?: GitPullRequestReviewLike }>(
    `/api/repositories/${encodeURIComponent(repoId)}/pull-requests/${
      encodeURIComponent(String(prNumber))
    }/reviews`,
    {
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      },
    },
  );
  if (!data.review) {
    throw new Error("Pull request review response is missing review");
  }
  return { review: toFrontendPullRequestReview(data.review) };
}

/** POST /api/repositories/:repoId/pull-requests/:number/ai-review */
export async function repoRunPullRequestAiReview(
  repoId: string,
  prNumber: number | string,
): Promise<unknown> {
  return await apiJson(
    `/api/repositories/${encodeURIComponent(repoId)}/pull-requests/${
      encodeURIComponent(String(prNumber))
    }/ai-review`,
    { init: { method: "POST" } },
  );
}

/** POST /api/repositories/:repoId/pull-requests/:number/merge */
export async function repoMergePullRequest(
  repoId: string,
  prNumber: number | string,
): Promise<{ pull_request?: PullRequest }> {
  const data = await apiJson<{ pullRequest?: GitPullRequestDetailLike }>(
    `/api/repositories/${encodeURIComponent(repoId)}/pull-requests/${
      encodeURIComponent(String(prNumber))
    }/merge`,
    {
      init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
    },
  );
  return {
    pull_request: data.pullRequest
      ? toFrontendPullRequest(data.pullRequest)
      : undefined,
  };
}

async function loadPullRequestMergeability(
  repoId: string,
  prs: readonly GitPullRequestLike[],
): Promise<Map<string, GitCompareLike>> {
  const openPrs = prs.filter((pr) =>
    pr.status === "open" && pr.headBranch && pr.baseBranch
  );
  const entries = await Promise.all(openPrs.map(async (pr) => {
    try {
      const params = new URLSearchParams({
        base: pr.baseBranch as string,
        head: pr.headBranch as string,
      });
      const compare = await apiJson<GitCompareLike>(
        `/api/repositories/${
          encodeURIComponent(repoId)
        }/compare?${params.toString()}`,
      );
      return [pr.id, compare] as const;
    } catch {
      return undefined;
    }
  }));
  return new Map(
    entries.filter((entry): entry is readonly [string, GitCompareLike] =>
      entry !== undefined
    ),
  );
}

function repositoryRead(
  resource: "tree" | "blob",
  repoId: string,
  ref: string,
  query?: Record<string, string>,
): Promise<RpcResponse> {
  const params = new URLSearchParams(query ?? {});
  params.set("ref", ref);
  const path = `/api/repositories/${
    encodeURIComponent(repoId)
  }/${resource}?${params.toString()}`;
  return fetch(path, {
    headers: { Accept: "application/json" },
  }) as Promise<RpcResponse>;
}

interface GitPullRequestLike {
  id: string;
  number: number;
  title: string;
  description?: string | null;
  status: PullRequest["status"];
  authorAccountId?: string | null;
  headBranch?: string;
  baseBranch?: string;
  mergedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  comments?: readonly unknown[];
  reviews?: readonly unknown[];
}

interface GitCommitSummaryLike {
  sha: string;
  parents?: string[];
  authorName: string;
  authorEmail: string;
  authorDate: string;
  committerDate?: string;
  message: string;
}

interface GitRefSummaryLike {
  name: string;
  target: string;
}

interface GitPullRequestDetailLike extends GitPullRequestLike {
  comments: GitPullRequestCommentLike[];
  reviews: GitPullRequestReviewLike[];
}

interface GitPullRequestCommentLike {
  id: string;
  pullRequestId: string;
  authorAccountId?: string | null;
  body: string;
  path?: string | null;
  line?: number | null;
  createdAt: string;
}

interface GitPullRequestReviewLike {
  id: string;
  pullRequestId: string;
  reviewerAccountId?: string | null;
  status: PRReview["status"];
  body?: string | null;
  analysis?: string | null;
  createdAt: string;
}

interface GitPullRequestDiffFileLike {
  path: string;
  oldPath?: string;
  status: string;
  additions: number;
  deletions: number;
  hunks: GitPullRequestDiffHunkLike[];
}

interface GitPullRequestDiffHunkLike {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: GitPullRequestDiffLineLike[];
}

interface GitPullRequestDiffLineLike {
  type: "context" | "addition" | "deletion";
  content: string;
  oldLine?: number;
  newLine?: number;
}

interface GitCompareLike {
  baseCommit?: string;
  mergeBase?: string;
  aheadBy?: number;
}

function toFrontendPullRequest(
  pr: GitPullRequestLike,
  compare?: GitCompareLike,
): PullRequest {
  return {
    id: pr.id,
    number: pr.number,
    title: pr.title,
    description: pr.description ?? null,
    status: pr.status,
    // The git service only carries the account id; no display-name resolution
    // exists in the web RPC layer yet. Expose the real id and leave `name` null
    // so the UI renders a proper fallback instead of showing the raw id.
    author: {
      id: pr.authorAccountId ?? "",
      name: null,
    },
    source_branch: pr.headBranch ?? "",
    target_branch: pr.baseBranch ?? "",
    commits_count: compare?.aheadBy ?? 0,
    comments_count: pr.comments?.length ?? 0,
    reviews_count: pr.reviews?.length ?? 0,
    is_mergeable: pr.status === "open" &&
      Boolean(compare?.baseCommit && compare.mergeBase === compare.baseCommit),
    created_at: pr.createdAt,
    updated_at: pr.updatedAt,
    merged_at: pr.mergedAt ?? null,
    closed_at: pr.status === "closed" ? pr.updatedAt : null,
  };
}

function toFrontendCommit(commit: GitCommitSummaryLike): Commit {
  return {
    sha: commit.sha,
    message: commit.message,
    author: {
      name: commit.authorName,
      email: commit.authorEmail,
    },
    date: commit.committerDate ?? commit.authorDate,
    parents: commit.parents ?? [],
  };
}

function toFrontendBranch(
  ref: GitRefSummaryLike,
  defaultBranch: string,
): Branch {
  const name = ref.name.startsWith("refs/heads/")
    ? ref.name.slice("refs/heads/".length)
    : ref.name;
  // The refs endpoint only carries `{ name, target }`; branch protection is not
  // exposed here and no branch can currently be marked protected, so we do not
  // synthesize a protected flag. Add it (and the protected badge/guards) back
  // only when the git service actually reports protection status.
  return {
    name,
    commit_sha: ref.target,
    is_default: name === defaultBranch,
  };
}

function toFrontendPullRequestComment(
  comment: GitPullRequestCommentLike,
): PRComment {
  return {
    id: comment.id,
    author: {
      id: comment.authorAccountId ?? "",
      name: null,
    },
    body: comment.body,
    author_type: "user",
    path: comment.path ?? null,
    line: comment.line ?? null,
    created_at: comment.createdAt,
  };
}

function toFrontendPullRequestReview(
  review: GitPullRequestReviewLike,
): PRReview {
  return {
    id: review.id,
    author: {
      id: review.reviewerAccountId ?? "",
      name: null,
    },
    reviewer_type: "user",
    status: review.status,
    body: review.body ?? null,
    analysis: review.analysis ?? null,
    created_at: review.createdAt,
  };
}

function toFrontendPullRequestDiffFile(
  file: GitPullRequestDiffFileLike,
): FileDiff {
  return {
    path: file.path,
    old_path: file.oldPath,
    status: toFrontendDiffStatus(file.status),
    additions: file.additions,
    deletions: file.deletions,
    hunks: file.hunks.map((hunk) => ({
      old_start: hunk.oldStart,
      old_lines: hunk.oldLines,
      new_start: hunk.newStart,
      new_lines: hunk.newLines,
      lines: hunk.lines.map((line) => ({
        type: line.type,
        content: line.content,
        old_line: line.oldLine,
        new_line: line.newLine,
      })),
    })),
  };
}

function toFrontendDiffStatus(status: string): FileDiff["status"] {
  if (
    status === "added" || status === "modified" || status === "deleted" ||
    status === "renamed"
  ) {
    return status;
  }
  return "modified";
}
