import type { Hono } from "hono";
import type {
  GitCreatePullRequestCommentRequest,
  GitCreatePullRequestRequest,
  GitCreatePullRequestReviewRequest,
  GitMergePullRequestRequest,
  GitUpdatePullRequestRequest,
} from "takos-git-contract";
import { readInternalAuth } from "./auth.ts";
import {
  createConfiguredPullRequest,
  createConfiguredPullRequestComment,
  createConfiguredPullRequestReview,
  readConfiguredPullRequest,
  readConfiguredPullRequests,
  updateConfiguredPullRequest,
} from "./git.ts";
import { requireRepositoryRead, requireRepositoryWrite } from "./repo-store.ts";
import {
  buildPullRequestDiffResponse,
  mergePullRequestFastForward,
} from "./response-builders.ts";
import {
  isPullRequestStatus,
  parsePullRequestNumber,
  validateCreatePullRequest,
  validateCreatePullRequestComment,
  validateCreatePullRequestReview,
  validateMergePullRequest,
  validateUpdatePullRequest,
} from "./validation.ts";

export function registerPullRequestRoutes(app: Hono): void {
  app.get("/internal/repositories/:repositoryId/pull-requests", async (c) => {
    const auth = await readInternalAuth(c.req.raw);
    if (!auth.ok) return c.json({ error: auth.error }, 401);
    const access = await requireRepositoryRead(
      auth,
      c.req.param("repositoryId"),
    );
    if (!access.ok) return c.json(access.body, access.status);
    const status = c.req.query("status");
    if (status !== undefined && !isPullRequestStatus(status)) {
      return c.json({
        error: "status must be open, closed, or merged",
        code: "invalid_pull_request_status",
      }, 400);
    }
    const result = await readConfiguredPullRequests(
      c.req.param("repositoryId"),
      status,
    );
    if (!result.ok) return c.json(result.body, result.status);
    return c.json({ pullRequests: result.pullRequests });
  });

  app.post("/internal/repositories/:repositoryId/pull-requests", async (c) => {
    const auth = await readInternalAuth(c.req.raw);
    if (!auth.ok) return c.json({ error: auth.error }, 401);
    const access = await requireRepositoryWrite(
      auth,
      c.req.param("repositoryId"),
    );
    if (!access.ok) return c.json(access.body, access.status);
    const request = await c.req.json<Partial<GitCreatePullRequestRequest>>();
    const invalid = validateCreatePullRequest(request);
    if (invalid) return c.json(invalid, 400);
    const result = await createConfiguredPullRequest(
      c.req.param("repositoryId"),
      request as GitCreatePullRequestRequest,
      auth.actor,
    );
    if (!result.ok) return c.json(result.body, result.status);
    return c.json({ pullRequest: result.pullRequest }, 201);
  });

  app.get(
    "/internal/repositories/:repositoryId/pull-requests/:number",
    async (c) => {
      const auth = await readInternalAuth(c.req.raw);
      if (!auth.ok) return c.json({ error: auth.error }, 401);
      const access = await requireRepositoryRead(
        auth,
        c.req.param("repositoryId"),
      );
      if (!access.ok) return c.json(access.body, access.status);
      const number = parsePullRequestNumber(c.req.param("number"));
      if (!number.ok) return c.json(number.body, 400);
      const result = await readConfiguredPullRequest(
        c.req.param("repositoryId"),
        number.value,
      );
      if (!result.ok) return c.json(result.body, result.status);
      return c.json({ pullRequest: result.pullRequest });
    },
  );

  app.get(
    "/internal/repositories/:repositoryId/pull-requests/:number/diff",
    async (c) => {
      const auth = await readInternalAuth(c.req.raw);
      if (!auth.ok) return c.json({ error: auth.error }, 401);
      const access = await requireRepositoryRead(
        auth,
        c.req.param("repositoryId"),
      );
      if (!access.ok) return c.json(access.body, access.status);
      const number = parsePullRequestNumber(c.req.param("number"));
      if (!number.ok) return c.json(number.body, 400);
      const pullRequestResult = await readConfiguredPullRequest(
        c.req.param("repositoryId"),
        number.value,
      );
      if (!pullRequestResult.ok) {
        return c.json(pullRequestResult.body, pullRequestResult.status);
      }
      const diff = await buildPullRequestDiffResponse({
        repository: access.repository,
        pullRequestNumber: number.value,
        baseRef: pullRequestResult.pullRequest.baseBranch,
        headRef: pullRequestResult.pullRequest.headBranch,
      });
      if (!diff.ok) return c.json(diff.body, diff.status);
      return c.json(diff.response);
    },
  );

  app.patch(
    "/internal/repositories/:repositoryId/pull-requests/:number",
    async (c) => {
      const auth = await readInternalAuth(c.req.raw);
      if (!auth.ok) return c.json({ error: auth.error }, 401);
      const access = await requireRepositoryWrite(
        auth,
        c.req.param("repositoryId"),
      );
      if (!access.ok) return c.json(access.body, access.status);
      const number = parsePullRequestNumber(c.req.param("number"));
      if (!number.ok) return c.json(number.body, 400);
      const request = await c.req.json<Partial<GitUpdatePullRequestRequest>>();
      const invalid = validateUpdatePullRequest(request);
      if (invalid) return c.json(invalid, 400);
      const result = await updateConfiguredPullRequest(
        c.req.param("repositoryId"),
        number.value,
        request,
      );
      if (!result.ok) return c.json(result.body, result.status);
      return c.json({ pullRequest: result.pullRequest });
    },
  );

  app.post(
    "/internal/repositories/:repositoryId/pull-requests/:number/comments",
    async (c) => {
      const auth = await readInternalAuth(c.req.raw);
      if (!auth.ok) return c.json({ error: auth.error }, 401);
      const access = await requireRepositoryWrite(
        auth,
        c.req.param("repositoryId"),
      );
      if (!access.ok) return c.json(access.body, access.status);
      const number = parsePullRequestNumber(c.req.param("number"));
      if (!number.ok) return c.json(number.body, 400);
      const request = await c.req.json<
        Partial<GitCreatePullRequestCommentRequest>
      >();
      const invalid = validateCreatePullRequestComment(request);
      if (invalid) return c.json(invalid, 400);
      const result = await createConfiguredPullRequestComment(
        c.req.param("repositoryId"),
        number.value,
        request as GitCreatePullRequestCommentRequest,
        auth.actor,
      );
      if (!result.ok) return c.json(result.body, result.status);
      return c.json({ comment: result.comment }, 201);
    },
  );

  app.post(
    "/internal/repositories/:repositoryId/pull-requests/:number/reviews",
    async (c) => {
      const auth = await readInternalAuth(c.req.raw);
      if (!auth.ok) return c.json({ error: auth.error }, 401);
      const access = await requireRepositoryWrite(
        auth,
        c.req.param("repositoryId"),
      );
      if (!access.ok) return c.json(access.body, access.status);
      const number = parsePullRequestNumber(c.req.param("number"));
      if (!number.ok) return c.json(number.body, 400);
      const request = await c.req.json<
        Partial<GitCreatePullRequestReviewRequest>
      >();
      const invalid = validateCreatePullRequestReview(request);
      if (invalid) return c.json(invalid, 400);
      const result = await createConfiguredPullRequestReview(
        c.req.param("repositoryId"),
        number.value,
        request as GitCreatePullRequestReviewRequest,
        auth.actor,
      );
      if (!result.ok) return c.json(result.body, result.status);
      return c.json({ review: result.review }, 201);
    },
  );

  app.post(
    "/internal/repositories/:repositoryId/pull-requests/:number/merge",
    async (c) => {
      const auth = await readInternalAuth(c.req.raw);
      if (!auth.ok) return c.json({ error: auth.error }, 401);
      const access = await requireRepositoryWrite(
        auth,
        c.req.param("repositoryId"),
      );
      if (!access.ok) return c.json(access.body, access.status);
      const number = parsePullRequestNumber(c.req.param("number"));
      if (!number.ok) return c.json(number.body, 400);
      const request = await c.req.json<Partial<GitMergePullRequestRequest>>()
        .catch(() => ({}));
      const invalid = validateMergePullRequest(request);
      if (invalid) return c.json(invalid, 400);
      const result = await mergePullRequestFastForward(
        access.repository,
        number.value,
        request,
      );
      if (!result.ok) return c.json(result.body, result.status);
      return c.json(result.response);
    },
  );
}
