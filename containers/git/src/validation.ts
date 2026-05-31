import type {
  GitCreatePullRequestCommentRequest,
  GitCreatePullRequestRequest,
  GitCreatePullRequestReviewRequest,
  GitCreateRepositoryRequest,
  GitFetchExternalRepositoryRequest,
  GitImportExternalRepositoryRequest,
  GitMergePullRequestRequest,
  GitPullRequestReviewStatus,
  GitPullRequestStatus,
  GitUpdatePullRequestRequest,
  GitUpdateRepositoryRequest,
} from "takos-git-contract";
import { isLiteralObjectId, isSafeRefInput } from "./git.ts";

export function isSafeTreePath(path: string): boolean {
  return path === "." || (
    path.length > 0 &&
    !path.includes("\0") &&
    !path.includes("..") &&
    !path.includes("\\") &&
    !path.startsWith("/") &&
    !path.endsWith("/") &&
    path.split("/").every((part) => part.length > 0 && part !== ".")
  );
}

// Reject CR / LF / NUL and other control characters in caller-supplied
// `authHeader` values so they cannot inject extra HTTP headers or git
// `-c http.extraHeader=...` lines via header smuggling. We also reject
// the Unicode line-separator code points (NEL U+0085, LS U+2028, PS
// U+2029) because some downstream HTTP / TLS stacks (notably libcurl
// when fed via git http.extraHeader) treat them as line terminators
// and would let a header value smuggle a new header line through
// otherwise-ASCII control filtering.
export function isSafeAuthHeader(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0) return false;
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    // Reject ASCII control characters (0x00-0x1F) and DEL (0x7F).
    // This covers \r, \n, \0, \t, and other smuggling vectors.
    if (code < 0x20 || code === 0x7f) return false;
    // Reject Unicode line separators: NEL (U+0085), LS (U+2028), PS
    // (U+2029). Treat them as header-smuggling vectors as well.
    if (code === 0x85 || code === 0x2028 || code === 0x2029) return false;
  }
  return true;
}

export function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function repositoryOwnerSpaceId(
  request: Partial<GitCreateRepositoryRequest | GitUpdateRepositoryRequest>,
): string | undefined {
  const value = request.ownerSpaceId;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

export function isPullRequestStatus(
  value: unknown,
): value is GitPullRequestStatus {
  return value === "open" || value === "closed" || value === "merged";
}

export function isPullRequestReviewStatus(
  value: unknown,
): value is GitPullRequestReviewStatus {
  return value === "commented" || value === "approved" ||
    value === "changes_requested";
}

export function invalidPullRequestRequest(): { error: string; code: string } {
  return {
    error:
      "title, headBranch, and baseBranch are required; optional fields must use valid types",
    code: "invalid_pull_request_request",
  };
}

export function parsePullRequestNumber(value: string):
  | { ok: true; value: number }
  | { ok: false; body: { error: string; code: string } } {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    return {
      ok: false,
      body: {
        error: "pull request number must be a positive integer",
        code: "invalid_pull_request_number",
      },
    };
  }
  return { ok: true, value: number };
}

export function validateRepositoryMetadata(
  request: Partial<GitCreateRepositoryRequest | GitUpdateRepositoryRequest>,
  requireAll: boolean,
  normalizeRefs: (
    refs: GitCreateRepositoryRequest["refs"],
  ) => Map<string, string> | undefined,
): { error: string; code: string } | undefined {
  if (!request || typeof request !== "object") {
    return {
      error: "repository metadata request body is required",
      code: "invalid_repository_metadata_request",
    };
  }
  if ("ownerAccountId" in request) {
    return {
      error: "ownerAccountId is not supported; use ownerSpaceId",
      code: "invalid_repository_metadata_request",
    };
  }
  const checks: Array<[string, unknown, boolean]> = [
    ["id", "id" in request ? request.id : undefined, requireAll],
    ["name", request.name, requireAll],
    ["ownerSpaceId", repositoryOwnerSpaceId(request), requireAll],
    ["defaultBranch", request.defaultBranch, false],
  ];
  for (const [field, value, required] of checks) {
    if (value === undefined && !required) continue;
    if (typeof value !== "string" || value.trim().length === 0) {
      return {
        error: `${field} must be a non-empty string`,
        code: "invalid_repository_metadata_request",
      };
    }
  }
  const refs = request.refs;
  if (refs !== undefined && normalizeRefs(refs) === undefined) {
    return {
      error: "refs must be a name-to-commit map or ref summary array",
      code: "invalid_repository_refs",
    };
  }
  if (
    "initialization" in request &&
    request.initialization !== undefined &&
    (!request.initialization ||
      typeof request.initialization !== "object" ||
      !["default", "bare", undefined].includes(request.initialization.mode))
  ) {
    return {
      error: "initialization.mode must be default or bare",
      code: "invalid_repository_initialization",
    };
  }
}

export function validateExternalImportRequest(
  request: Partial<GitImportExternalRepositoryRequest> | undefined,
  normalizeRefs: (
    refs: GitCreateRepositoryRequest["refs"],
  ) => Map<string, string> | undefined,
): { error: string; code: string } | undefined {
  const invalidMetadata = validateRepositoryMetadata(
    request ?? {},
    true,
    normalizeRefs,
  );
  if (invalidMetadata) return invalidMetadata;
  if (!nonEmptyString(request?.remoteUrl)) {
    return {
      error: "remoteUrl must be a non-empty string",
      code: "invalid_external_import_request",
    };
  }
  if (
    request.authHeader !== undefined &&
    request.authHeader !== null
  ) {
    if (typeof request.authHeader !== "string") {
      return {
        error: "authHeader must be a string or null",
        code: "invalid_external_import_request",
      };
    }
    if (!isSafeAuthHeader(request.authHeader)) {
      return {
        error:
          "authHeader must not contain CR, LF, NUL, or other control characters",
        code: "invalid_external_import_request",
      };
    }
  }
}

export function validateExternalFetchRequest(
  request: Partial<GitFetchExternalRepositoryRequest> | undefined,
): { error: string; code: string } | undefined {
  if (!request || typeof request !== "object") {
    return {
      error: "external fetch request body is required",
      code: "invalid_external_fetch_request",
    };
  }
  if (!nonEmptyString(request.remoteUrl)) {
    return {
      error: "remoteUrl must be a non-empty string",
      code: "invalid_external_fetch_request",
    };
  }
  if (
    request.authHeader !== undefined &&
    request.authHeader !== null
  ) {
    if (typeof request.authHeader !== "string") {
      return {
        error: "authHeader must be a string or null",
        code: "invalid_external_fetch_request",
      };
    }
    if (!isSafeAuthHeader(request.authHeader)) {
      return {
        error:
          "authHeader must not contain CR, LF, NUL, or other control characters",
        code: "invalid_external_fetch_request",
      };
    }
  }
}

export function validateCreatePullRequest(
  request: Partial<GitCreatePullRequestRequest>,
): { error: string; code: string } | undefined {
  if (!request || typeof request !== "object") {
    return invalidPullRequestRequest();
  }
  for (
    const field of ["title", "headBranch", "baseBranch"] as const
  ) {
    const value = request[field];
    if (typeof value !== "string" || value.trim().length === 0) {
      return invalidPullRequestRequest();
    }
  }
  if (
    !isSafeRefInput(request.headBranch!) ||
    !isSafeRefInput(request.baseBranch!)
  ) {
    return {
      error: "headBranch and baseBranch must be safe ref names",
      code: "invalid_pull_request_refs",
    };
  }
  if (
    request.description !== undefined && typeof request.description !== "string"
  ) {
    return invalidPullRequestRequest();
  }
  if (request.runId !== undefined && typeof request.runId !== "string") {
    return invalidPullRequestRequest();
  }
}

export function validateUpdatePullRequest(
  request: Partial<GitUpdatePullRequestRequest>,
): { error: string; code: string } | undefined {
  if (!request || typeof request !== "object") {
    return invalidPullRequestRequest();
  }
  if (request.title !== undefined && !nonEmptyString(request.title)) {
    return invalidPullRequestRequest();
  }
  if (
    request.description !== undefined && typeof request.description !== "string"
  ) {
    return invalidPullRequestRequest();
  }
  if (request.status !== undefined && !isPullRequestStatus(request.status)) {
    return {
      error: "status must be open, closed, or merged",
      code: "invalid_pull_request_status",
    };
  }
}

export function validateCreatePullRequestComment(
  request: Partial<GitCreatePullRequestCommentRequest>,
): { error: string; code: string } | undefined {
  if (
    !request || typeof request !== "object" || !nonEmptyString(request.body)
  ) {
    return {
      error: "comment body must be a non-empty string",
      code: "invalid_pull_request_comment_request",
    };
  }
  if (request.path !== undefined && !isSafeTreePath(request.path)) {
    return {
      error: "comment path must be a safe repository-relative path",
      code: "invalid_pull_request_comment_path",
    };
  }
  if (
    request.line !== undefined &&
    (!Number.isInteger(request.line) || request.line < 1)
  ) {
    return {
      error: "comment line must be a positive integer",
      code: "invalid_pull_request_comment_line",
    };
  }
}

export function validateCreatePullRequestReview(
  request: Partial<GitCreatePullRequestReviewRequest>,
): { error: string; code: string } | undefined {
  if (
    !request || typeof request !== "object" ||
    !isPullRequestReviewStatus(request.status)
  ) {
    return {
      error: "review status must be commented, approved, or changes_requested",
      code: "invalid_pull_request_review_request",
    };
  }
  if (request.body !== undefined && typeof request.body !== "string") {
    return {
      error: "review body must be a string",
      code: "invalid_pull_request_review_request",
    };
  }
  if (request.analysis !== undefined && typeof request.analysis !== "string") {
    return {
      error: "review analysis must be a string",
      code: "invalid_pull_request_review_request",
    };
  }
}

export function validateMergePullRequest(
  request: Partial<GitMergePullRequestRequest>,
): { error: string; code: string } | undefined {
  if (!request || typeof request !== "object") {
    return {
      error: "merge request body must be an object",
      code: "invalid_pull_request_merge_request",
    };
  }
  if (
    request.mergeMethod !== undefined && request.mergeMethod !== "ff-only"
  ) {
    return {
      error: "mergeMethod must be ff-only",
      code: "invalid_pull_request_merge_method",
    };
  }
  if (
    request.expectedHead !== undefined &&
    (typeof request.expectedHead !== "string" ||
      !isLiteralObjectId(request.expectedHead))
  ) {
    return {
      error: "expectedHead must be a literal commit id",
      code: "invalid_pull_request_expected_head",
    };
  }
}
