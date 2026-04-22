import type {
  AuthorType,
  PullRequestStatus,
} from "../../../shared/types/index.ts";
import type { SelectOf } from "../../../shared/types/drizzle-utils.ts";
import type { pullRequests } from "../../../infra/db/schema.ts";
import { accounts } from "../../../infra/db/schema.ts";
import { type Database, getDb } from "../../../infra/db/index.ts";
import { inArray } from "drizzle-orm";
import type { D1Database } from "../../../shared/types/bindings.ts";
import { textDate, textDateNullable } from "../../../shared/utils/db-guards.ts";
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
  status: "open" | "merged" | "closed";
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
  reviewer_type: "user" | "ai";
  reviewer_id: string | null;
  status: "approved" | "changes_requested" | "commented";
  body: string | null;
  analysis: string | null;
  created_at: string;
  author: UserLiteDto;
};

export type PullRequestCommentDto = {
  id: string;
  pr_id: string;
  author_type: "user" | "ai";
  author_id: string | null;
  body: string;
  path: string | null;
  line: number | null;
  created_at: string;
  author: UserLiteDto;
};

export const AI_USER_LITE: UserLiteDto = {
  id: "ai",
  name: "Takos AI",
  avatar_url: null,
};

export const AGENT_USER_LITE: UserLiteDto = {
  id: "agent",
  name: "Takos Agent",
  avatar_url: null,
};

export const UNKNOWN_USER_LITE: UserLiteDto = {
  id: "unknown",
  name: "Unknown",
  avatar_url: null,
};

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

export function toUserLiteDto(user: UserRecordLite): UserLiteDto {
  return {
    id: user.id,
    name: user.name,
    avatar_url: user.picture || null,
  };
}

export async function buildUserLiteMap(
  dbOrD1: Database | D1Database,
  userIds: string[],
): Promise<Map<string, UserLiteDto>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (ids.length === 0) {
    return new Map();
  }

  const db =
    "select" in dbOrD1 && typeof (dbOrD1 as Database).select === "function"
      ? dbOrD1 as Database
      : getDb(dbOrD1 as D1Database);

  const users = await db.select({
    id: accounts.id,
    name: accounts.name,
    picture: accounts.picture,
  }).from(accounts).where(inArray(accounts.id, ids)).all();

  return new Map(users.map((u) => [u.id, toUserLiteDto(u)]));
}

export function resolveActorLite(options: {
  actorType: string | null | undefined;
  actorId: string | null | undefined;
  userMap: Map<string, UserLiteDto>;
}): UserLiteDto {
  const type = (options.actorType || "").toLowerCase();
  const id = options.actorId || null;

  if (type === "ai") {
    return AI_USER_LITE;
  }
  if (type === "agent") {
    return AGENT_USER_LITE;
  }

  if (id) {
    return options.userMap.get(id) || { ...UNKNOWN_USER_LITE, id };
  }

  return UNKNOWN_USER_LITE;
}

export function toPullRequestRecord(record: PrRecord): PullRequestRecord {
  return {
    id: record.id,
    repoId: record.repoId,
    number: record.number,
    title: record.title,
    description: record.description,
    headBranch: record.headBranch,
    baseBranch: record.baseBranch,
    status: record.status as PullRequestStatus,
    authorType: record.authorType as AuthorType,
    authorId: record.authorId,
    createdAt: textDate(record.createdAt),
    updatedAt: textDate(record.updatedAt),
    mergedAt: textDateNullable(record.mergedAt),
  };
}

export function toPullRequestDto(
  pullRequest: PullRequestRecord,
  options: {
    author: UserLiteDto;
    commitsCount: number;
    commentsCount: number;
    reviewsCount: number;
    isMergeable: boolean;
  },
): PullRequestDto {
  const status: PullRequestDto["status"] =
    pullRequest.status === "merged" || pullRequest.status === "closed"
      ? pullRequest.status
      : "open";
  const mergedAt = pullRequest.mergedAt || null;
  const closedAt = status === "closed" ? pullRequest.updatedAt : null;

  return {
    id: pullRequest.id,
    repo_id: pullRequest.repoId,
    number: pullRequest.number,
    title: pullRequest.title,
    description: pullRequest.description,
    status,
    author: options.author,
    source_branch: pullRequest.headBranch,
    target_branch: pullRequest.baseBranch,
    commits_count: options.commitsCount,
    comments_count: options.commentsCount,
    reviews_count: options.reviewsCount,
    is_mergeable: options.isMergeable,
    created_at: textDate(pullRequest.createdAt),
    updated_at: textDate(pullRequest.updatedAt),
    merged_at: textDateNullable(mergedAt),
    closed_at: textDateNullable(closedAt),
  };
}

export async function buildPullRequestDtoFull(
  db: Database,
  pullRequest: PullRequestRecord,
): Promise<PullRequestDto> {
  const { prReviews, prComments } = await import("../../../infra/db/schema.ts");
  const { count, eq } = await import("drizzle-orm");

  const [reviewResult, commentResult] = await Promise.all([
    db.select({ count: count() }).from(prReviews).where(
      eq(prReviews.prId, pullRequest.id),
    ).get(),
    db.select({ count: count() }).from(prComments).where(
      eq(prComments.prId, pullRequest.id),
    ).get(),
  ]);
  const reviewsCount = reviewResult?.count ?? 0;
  const commentsCount = commentResult?.count ?? 0;

  const userMap = await buildUserLiteMap(
    db,
    pullRequest.authorType === "user" && pullRequest.authorId
      ? [pullRequest.authorId]
      : [],
  );
  const author = resolveActorLite({
    actorType: pullRequest.authorType,
    actorId: pullRequest.authorId,
    userMap,
  });

  return toPullRequestDto(pullRequest, {
    author,
    commitsCount: 0,
    commentsCount,
    reviewsCount,
    isMergeable: pullRequest.status === "open",
  });
}
