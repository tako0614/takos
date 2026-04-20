import type { ContentfulStatusCode } from "hono/utils/http-status";
import type {
  Env,
  PullRequestComment,
  PullRequestCommentAuthorType,
  PullRequestReview,
  ReviewerType,
  ReviewStatus,
} from "../../../shared/types/index.ts";
import type { AgentMessage } from "../agent/agent-models.ts";
import {
  generateId,
  safeJsonParseOrDefault,
} from "../../../shared/utils/index.ts";
import { textDate } from "../../../shared/utils/db-guards.ts";
import { getWorkspaceModelSettings } from "../identity/spaces.ts";
import {
  DEFAULT_MODEL_ID,
  getBackendFromModel,
  LLMClient,
  normalizeModelId,
} from "../agent/index.ts";
import { getDb, prComments, prReviews } from "../../../infra/db/index.ts";
import { and, eq } from "drizzle-orm";
import * as gitStore from "../git-smart/index.ts";
import {
  decodeBlobContent,
  formatUnifiedDiff,
} from "../../../shared/utils/unified-diff.ts";
import { toGitBucket } from "../../../shared/utils/git-bucket.ts";

type GitBucket = Parameters<typeof gitStore.getBlob>[0];

function getCommitData(bucket: GitBucket, sha: string) {
  return gitStore.getCommitData(bucket, sha);
}

function flattenTree(bucket: GitBucket, treeSha: string) {
  return gitStore.flattenTree(bucket, treeSha);
}

function getBlob(bucket: GitBucket, sha: string) {
  return gitStore.getBlob(bucket, sha);
}

export type AiReviewResult = {
  review: PullRequestReview;
  comments: PullRequestComment[];
  model: string;
  backend: string;
};

type PullRequestRecord = {
  id: string;
  number: number;
  title: string;
  description: string | null;
  headBranch: string;
  baseBranch: string;
};

type PullRequestReviewRecord = {
  id: string;
  prId: string;
  reviewerType: ReviewerType | string;
  reviewerId: string | null;
  status: ReviewStatus | string;
  body: string | null;
  analysis: string | null;
  createdAt: string | Date;
};

type PullRequestCommentRecord = {
  id: string;
  prId: string;
  authorType: PullRequestCommentAuthorType | string;
  authorId: string | null;
  content: string;
  filePath: string | null;
  lineNumber: number | null;
  createdAt: string | Date;
};

export class AiReviewError extends Error {
  status: ContentfulStatusCode;
  details?: string;

  constructor(
    message: string,
    status: ContentfulStatusCode = 500,
    details?: string,
  ) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

function toReviewStatus(value: string): ReviewStatus {
  if (
    value === "approved" || value === "changes_requested" ||
    value === "commented"
  ) {
    return value;
  }
  return "commented";
}

function toReviewerType(value: string): ReviewerType {
  if (value === "user" || value === "ai") {
    return value;
  }
  return "ai";
}

function toCommentAuthorType(value: string): PullRequestCommentAuthorType {
  if (value === "user" || value === "ai") {
    return value;
  }
  return "ai";
}

function toPullRequestReviewDto(
  review: PullRequestReviewRecord,
): PullRequestReview {
  return {
    id: review.id,
    pr_id: review.prId,
    reviewer_type: toReviewerType(review.reviewerType),
    reviewer_id: review.reviewerId,
    status: toReviewStatus(review.status),
    body: review.body,
    analysis: review.analysis,
    created_at: textDate(review.createdAt),
  };
}

function toPullRequestCommentDto(
  comment: PullRequestCommentRecord,
): PullRequestComment {
  return {
    id: comment.id,
    pr_id: comment.prId,
    author_type: toCommentAuthorType(comment.authorType),
    author_id: comment.authorId,
    content: comment.content,
    file_path: comment.filePath,
    line_number: comment.lineNumber,
    created_at: textDate(comment.createdAt),
  };
}

export async function buildPRDiffText(
  env: Env,
  repoId: string,
  baseRef: string,
  headRef: string,
) {
  const bucketBinding = env.GIT_OBJECTS;
  if (!bucketBinding) {
    throw new Error("Git storage not configured");
  }
  const bucket = toGitBucket(bucketBinding);

  const baseSha = await gitStore.resolveRef(env.DB, repoId, baseRef);
  const headSha = await gitStore.resolveRef(env.DB, repoId, headRef);

  if (!baseSha || !headSha) {
    throw new Error("Ref not found");
  }

  const baseCommit = await getCommitData(bucket, baseSha);
  const headCommit = await getCommitData(bucket, headSha);
  if (!baseCommit || !headCommit) {
    throw new Error("Commit not found");
  }

  const baseFiles = await flattenTree(bucket, baseCommit.tree);
  const headFiles = await flattenTree(bucket, headCommit.tree);
  const baseMap = new Map(baseFiles.map((f) => [f.path, f.sha]));
  const headMap = new Map(headFiles.map((f) => [f.path, f.sha]));

  const changes: Array<
    {
      path: string;
      status: "added" | "modified" | "deleted";
      oldOid?: string;
      newOid?: string;
    }
  > = [];
  for (const [path, oid] of headMap) {
    const baseOid = baseMap.get(path);
    if (!baseOid) {
      changes.push({ path, status: "added", newOid: oid });
    } else if (baseOid !== oid) {
      changes.push({ path, status: "modified", oldOid: baseOid, newOid: oid });
    }
  }
  for (const [path, oid] of baseMap) {
    if (!headMap.has(path)) {
      changes.push({ path, status: "deleted", oldOid: oid });
    }
  }

  changes.sort((a, b) => a.path.localeCompare(b.path));

  const MAX_FILES = 500;
  const MAX_DIFF_CHARS = 1_000_000;
  let diffText = "";
  const skipped: string[] = [];

  for (const change of changes.slice(0, MAX_FILES)) {
    let oldContent = "";
    let newContent = "";
    if (change.oldOid) {
      const blob = await getBlob(bucket, change.oldOid);
      if (blob) {
        const decoded = decodeBlobContent(blob);
        if (decoded.isBinary) {
          skipped.push(`${change.path} (binary)`);
          continue;
        }
        oldContent = decoded.text;
      }
    }
    if (change.newOid) {
      const blob = await getBlob(bucket, change.newOid);
      if (blob) {
        const decoded = decodeBlobContent(blob);
        if (decoded.isBinary) {
          skipped.push(`${change.path} (binary)`);
          continue;
        }
        newContent = decoded.text;
      }
    }

    const fileDiff = formatUnifiedDiff(
      change.path,
      oldContent,
      newContent,
      change.status,
    );
    if (diffText.length + fileDiff.length > MAX_DIFF_CHARS) {
      skipped.push("diff truncated");
      break;
    }
    diffText += fileDiff;
  }

  return {
    diffText: diffText.trim(),
    totalFiles: changes.length,
    skipped,
  };
}

export async function runAiReview(options: {
  env: Env;
  repoId: string;
  pullRequest: PullRequestRecord;
  spaceId: string;
}): Promise<AiReviewResult> {
  const { env, repoId, pullRequest, spaceId } = options;

  const workspaceModel = await getWorkspaceModelSettings(env.DB, spaceId);
  const model = normalizeModelId(workspaceModel?.ai_model) || DEFAULT_MODEL_ID;
  const backend = getBackendFromModel(model);

  let apiKey: string | undefined;
  if (backend === "openai") {
    apiKey = env.OPENAI_API_KEY;
  } else if (backend === "anthropic") {
    apiKey = env.ANTHROPIC_API_KEY;
  } else {
    apiKey = env.GOOGLE_API_KEY;
  }

  if (!apiKey) {
    throw new AiReviewError(`AI backend not configured for ${backend}`, 500);
  }

  let diffResult;
  try {
    diffResult = await buildPRDiffText(
      env,
      repoId,
      pullRequest.baseBranch,
      pullRequest.headBranch,
    );
  } catch (err) {
    throw new AiReviewError("Failed to build PR diff", 500, String(err));
  }

  const systemPrompt = [
    "You are a senior code reviewer.",
    "Review the diff and return JSON only.",
    "JSON schema:",
    '{ "status": "approved|changes_requested|commented", "summary": string, "issues": string[], "comments": [{ "file_path": string, "line_number": number, "content": string }] }',
    'Be concise. If no issues, set status to "approved".',
  ].join("\n");

  const userPrompt = [
    `PR: #${pullRequest.number} ${pullRequest.title}`,
    pullRequest.description
      ? `Description: ${pullRequest.description}`
      : "Description: (none)",
    `Base: ${pullRequest.baseBranch} Head: ${pullRequest.headBranch}`,
    `Changed files: ${diffResult.totalFiles}`,
    diffResult.skipped.length > 0
      ? `Skipped: ${diffResult.skipped.join(", ")}`
      : "",
    "--- DIFF START ---",
    diffResult.diffText || "(no textual diff available)",
    "--- DIFF END ---",
  ].filter(Boolean).join("\n");

  const messages: AgentMessage[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: userPrompt },
  ];

  const llm = new LLMClient({
    apiKey,
    model,
    backend,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    googleApiKey: env.GOOGLE_API_KEY,
  });

  let llmContent = "";
  try {
    const response = await llm.chat(messages);
    llmContent = response.content || "";
  } catch (err) {
    throw new AiReviewError("AI review failed", 500, String(err));
  }

  const jsonCandidate = llmContent.match(/\{[\s\S]*\}/)?.[0] || llmContent;
  const parsed = safeJsonParseOrDefault<{
    status?: ReviewStatus;
    summary?: string;
    issues?: string[];
    comments?: Array<
      { file_path?: string; line_number?: number; content?: string }
    >;
  }>(jsonCandidate, {});

  const reviewStatus: ReviewStatus = parsed?.status &&
      ["approved", "changes_requested", "commented"].includes(parsed.status)
    ? parsed.status
    : (parsed?.issues && parsed.issues.length > 0
      ? "changes_requested"
      : "commented");

  const summary = parsed?.summary ||
    (llmContent ? llmContent.slice(0, 1000) : "AI review completed.");
  const issues = parsed?.issues || [];
  const reviewBody = [
    summary,
    issues.length > 0
      ? `\nIssues:\n${issues.map((issue: string) => `- ${issue}`).join("\n")}`
      : "",
  ].filter(Boolean).join("\n");

  const db = getDb(env.DB);
  const reviewId = generateId();
  const timestamp = new Date().toISOString();

  const review = await db.insert(prReviews).values({
    id: reviewId,
    prId: pullRequest.id,
    reviewerType: "ai",
    reviewerId: null,
    status: reviewStatus,
    body: reviewBody,
    analysis: llmContent || null,
    createdAt: timestamp,
  }).returning().get();

  const rawComments = parsed?.comments || [];
  const commentsToCreate = rawComments
    .filter((
      cmt: { file_path?: string; line_number?: number; content?: string },
    ) => cmt.content && cmt.file_path)
    .slice(0, 20)
    .map((
      cmt: { file_path?: string; line_number?: number; content?: string },
    ) => ({
      id: generateId(),
      prId: pullRequest.id,
      authorType: "ai",
      authorId: null,
      content: cmt.content!.slice(0, 2000),
      filePath: cmt.file_path!,
      lineNumber: cmt.line_number ?? null,
      createdAt: timestamp,
    }));

  if (commentsToCreate.length > 0) {
    for (const commentData of commentsToCreate) {
      await db.insert(prComments).values(commentData);
    }
  }

  const comments = await db.select().from(prComments)
    .where(and(
      eq(prComments.prId, pullRequest.id),
      eq(prComments.authorType, "ai"),
      eq(prComments.createdAt, timestamp),
    ))
    .all();

  return {
    review: toPullRequestReviewDto(review),
    comments: comments.map((comment) => toPullRequestCommentDto(comment)),
    model,
    backend,
  };
}
