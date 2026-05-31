import type {
  GitCompareResponse,
  GitFetchExternalRepositoryRequest,
  GitFetchExternalRepositoryResponse,
  GitImportExternalRepositoryRequest,
  GitImportExternalRepositoryResponse,
  GitListCommitsResponse,
  GitListRefsResponse,
  GitMergePullRequestRequest,
  GitMergePullRequestResponse,
  GitReadBlobResponse,
  GitReadCommitResponse,
  GitReadTreeResponse,
} from "takos-git-contract";
import {
  TAKOS_GIT_CAPABILITIES,
  TAKOS_GIT_INTERNAL_PATHS,
} from "takos-git-contract";
import {
  type TakosumiActorContext as TakosActorContext,
  TakosumiInternalClient as TakosInternalClient,
} from "takosumi-contract/internal/rpc";
import type { Env, User } from "../../../shared/types/index.ts";

export class TakosGitClientError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = "TakosGitClientError";
  }
}

export interface TakosGitActorInput {
  readonly user?: Pick<User, "id"> | null;
  readonly spaceId: string;
  readonly roles?: readonly string[];
  readonly requestId?: string;
}

export interface TakosGitClient {
  importExternalRepository(
    request: GitImportExternalRepositoryRequest,
  ): Promise<GitImportExternalRepositoryResponse>;
  fetchExternalRepository(input: {
    repositoryId: string;
    request: GitFetchExternalRepositoryRequest;
  }): Promise<GitFetchExternalRepositoryResponse>;
  listBranches(repositoryId: string): Promise<GitListRefsResponse>;
  listTags(repositoryId: string): Promise<GitListRefsResponse>;
  readTree(input: {
    repositoryId: string;
    ref: string;
    path?: string;
  }): Promise<GitReadTreeResponse>;
  readBlob(input: {
    repositoryId: string;
    ref: string;
    path: string;
  }): Promise<GitReadBlobResponse>;
  listCommits(input: {
    repositoryId: string;
    ref: string;
    path?: string;
    limit?: number;
  }): Promise<GitListCommitsResponse>;
  readCommit(input: {
    repositoryId: string;
    commitish: string;
  }): Promise<GitReadCommitResponse>;
  compare(input: {
    repositoryId: string;
    base: string;
    head: string;
  }): Promise<GitCompareResponse>;
  mergePullRequest(input: {
    repositoryId: string;
    number: number;
    request?: GitMergePullRequestRequest;
  }): Promise<GitMergePullRequestResponse>;
}

export function createTakosGitClient(
  env: Pick<Env, "TAKOS_GIT_INTERNAL_URL" | "TAKOS_INTERNAL_SERVICE_SECRET">,
  actorInput: TakosGitActorInput,
): TakosGitClient {
  const baseUrl = env.TAKOS_GIT_INTERNAL_URL?.trim();
  const secret = env.TAKOS_INTERNAL_SERVICE_SECRET?.trim();
  if (!baseUrl || !secret) {
    throw new TakosGitClientError(
      "takos-git internal client is not configured",
      500,
      "takos_git_not_configured",
    );
  }
  const actor = takosGitActor(actorInput);
  const client = new TakosInternalClient({
    caller: "takos-worker",
    audience: "takos-git",
    baseUrl,
    secret,
  });

  return {
    importExternalRepository(request) {
      return requestJson<GitImportExternalRepositoryResponse>({
        client,
        actor,
        method: "POST",
        path: TAKOS_GIT_INTERNAL_PATHS.importExternalRepository,
        body: JSON.stringify(request),
        capabilities: [TAKOS_GIT_CAPABILITIES.repoImport],
      });
    },
    fetchExternalRepository(input) {
      return requestJson<GitFetchExternalRepositoryResponse>({
        client,
        actor,
        method: "POST",
        path: TAKOS_GIT_INTERNAL_PATHS.fetchExternalRepository(
          input.repositoryId,
        ),
        body: JSON.stringify(input.request),
        capabilities: [TAKOS_GIT_CAPABILITIES.repoImport],
      });
    },
    listBranches(repositoryId) {
      return requestJson<GitListRefsResponse>({
        client,
        actor,
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.repositoryBranches(repositoryId),
        capabilities: [TAKOS_GIT_CAPABILITIES.repoRead],
      });
    },
    listTags(repositoryId) {
      return requestJson<GitListRefsResponse>({
        client,
        actor,
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.repositoryTags(repositoryId),
        capabilities: [TAKOS_GIT_CAPABILITIES.repoRead],
      });
    },
    readTree(input) {
      return requestJson<GitReadTreeResponse>({
        client,
        actor,
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.repositoryTree(input.repositoryId),
        search: searchParams({
          ref: input.ref,
          path: input.path ?? ".",
        }),
        capabilities: [TAKOS_GIT_CAPABILITIES.repoRead],
      });
    },
    readBlob(input) {
      return requestJson<GitReadBlobResponse>({
        client,
        actor,
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.repositoryBlob(input.repositoryId),
        search: searchParams({ ref: input.ref, path: input.path }),
        capabilities: [TAKOS_GIT_CAPABILITIES.repoRead],
      });
    },
    listCommits(input) {
      return requestJson<GitListCommitsResponse>({
        client,
        actor,
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.repositoryCommits(input.repositoryId),
        search: searchParams({
          ref: input.ref,
          path: input.path,
          limit: input.limit === undefined ? undefined : String(input.limit),
        }),
        capabilities: [TAKOS_GIT_CAPABILITIES.repoRead],
      });
    },
    readCommit(input) {
      return requestJson<GitReadCommitResponse>({
        client,
        actor,
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.repositoryCommit(
          input.repositoryId,
          input.commitish,
        ),
        capabilities: [TAKOS_GIT_CAPABILITIES.repoRead],
      });
    },
    compare(input) {
      return requestJson<GitCompareResponse>({
        client,
        actor,
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.repositoryCompare(input.repositoryId),
        search: searchParams({ base: input.base, head: input.head }),
        capabilities: [TAKOS_GIT_CAPABILITIES.repoRead],
      });
    },
    mergePullRequest(input) {
      return requestJson<GitMergePullRequestResponse>({
        client,
        actor,
        method: "POST",
        path: TAKOS_GIT_INTERNAL_PATHS.pullRequestMerge(
          input.repositoryId,
          input.number,
        ),
        body: JSON.stringify(input.request ?? { mergeMethod: "ff-only" }),
        capabilities: [TAKOS_GIT_CAPABILITIES.prMerge],
      });
    },
  };
}

function takosGitActor(input: TakosGitActorInput): TakosActorContext {
  return {
    actorAccountId: input.user?.id ?? "public",
    roles: [...(input.roles ?? ["viewer"])],
    requestId: input.requestId ?? crypto.randomUUID(),
    spaceId: input.spaceId,
  };
}

async function requestJson<T>(input: {
  readonly client: TakosInternalClient;
  readonly actor: TakosActorContext;
  readonly method: string;
  readonly path: string;
  readonly search?: string;
  readonly body?: string;
  readonly capabilities: readonly string[];
}): Promise<T> {
  const response = await input.client.request({
    method: input.method,
    path: input.path,
    search: input.search,
    body: input.body ?? "",
    actor: input.actor,
    capabilities: input.capabilities,
  });
  if (!response.ok) {
    const body = await readErrorBody(response);
    throw new TakosGitClientError(
      typeof body === "object" && body && "error" in body
        ? String((body as { error?: unknown }).error)
        : `takos-git request failed with ${response.status}`,
      response.status,
      typeof body === "object" && body && "code" in body
        ? String((body as { code?: unknown }).code)
        : undefined,
      body,
    );
  }
  return await response.json() as T;
}

async function readErrorBody(response: Response): Promise<unknown> {
  const text = await response.text().catch(() => "");
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function searchParams(input: Record<string, string | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) params.set(key, value);
  }
  return params.toString();
}
