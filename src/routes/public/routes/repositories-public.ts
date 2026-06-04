import type { Context, Hono } from "hono";
import {
  type GitResolveSourceRequest,
  TAKOS_GIT_CAPABILITIES,
  TAKOS_GIT_INTERNAL_PATHS,
} from "takos-git-contract";
import type { ApiBindings } from "../shared/api/bindings.ts";
import { commonError, isRecord, readJsonBody } from "../shared/api/common.ts";
import {
  actorSpaceIdFromPublicJsonBody,
  forwardGitInternalRequest,
} from "../shared/api/forwarding.ts";
import {
  requireSpaceMembership,
  type SpaceMembershipGuardResult,
} from "../shared/spaces/access.ts";

/**
 * Resolves the caller's actor identity and confirms they are a member of the
 * space identified by the `spaceId` query parameter. The previous code passed
 * `c.req.query("spaceId")` straight through to takos-git, which let any
 * authenticated caller spoof a tenant boundary by attaching an arbitrary
 * spaceId — IDOR. We now require a spaceId AND verify membership against
 * `account_memberships` before forwarding so the caller's actor context is
 * known-good before the signed RPC fires.
 */
async function requireSpaceMembershipFromQuery(
  c: Context<{ Bindings: ApiBindings }>,
): Promise<SpaceMembershipGuardResult> {
  const spaceId = c.req.query("spaceId")?.trim() || "";
  if (!spaceId) {
    return {
      ok: false,
      response: c.json(
        commonError("INVALID_ARGUMENT", "spaceId is required"),
        400,
      ),
    };
  }
  return await requireSpaceMembership(c, spaceId);
}

function spaceIdFromMutationBody(
  body: string,
  fallback?: string,
): string | undefined {
  return actorSpaceIdFromPublicJsonBody(body) ?? fallback;
}

export function registerRepositoriesPublicRoutes(
  app: Hono<{ Bindings: ApiBindings }>,
): void {
  app.get("/api/repositories", async (c) => {
    const guard = await requireSpaceMembershipFromQuery(c);
    if (!guard.ok) return guard.response;
    const response = await forwardGitInternalRequest({
      request: c.req.raw,
      method: "GET",
      path: TAKOS_GIT_INTERNAL_PATHS.repositories,
      body: "",
      actor: guard.actor,
      actorSpaceId: guard.spaceId,
      capabilities: [TAKOS_GIT_CAPABILITIES.repoRead],
    });
    return response;
  });

  app.get("/api/repositories/:repositoryId", async (c) => {
    const guard = await requireSpaceMembershipFromQuery(c);
    if (!guard.ok) return guard.response;
    const response = await forwardGitInternalRequest({
      request: c.req.raw,
      method: "GET",
      path: TAKOS_GIT_INTERNAL_PATHS.repository(c.req.param("repositoryId")),
      body: "",
      actor: guard.actor,
      actorSpaceId: guard.spaceId,
      capabilities: [TAKOS_GIT_CAPABILITIES.repoRead],
    });
    return response;
  });

  app.post("/api/source/resolve", async (c) => {
    const body = await readJsonBody(c.req);
    if (!isRecord(body)) {
      return c.json(
        commonError("INVALID_ARGUMENT", "request body must be a JSON object"),
        400,
      );
    }
    const spaceId =
      (typeof body.spaceId === "string" ? body.spaceId : "").trim() || "";
    if (!spaceId) {
      return c.json(
        commonError("INVALID_ARGUMENT", "spaceId is required"),
        400,
      );
    }
    const guard = await requireSpaceMembership(c, spaceId);
    if (!guard.ok) return guard.response;
    const actor = guard.actor;
    const payload: GitResolveSourceRequest = {
      repositoryId: typeof body.repositoryId === "string"
        ? body.repositoryId
        : "",
      sourceRef: typeof body.sourceRef === "string" ? body.sourceRef : "",
    };
    const response = await forwardGitInternalRequest({
      request: c.req.raw,
      method: "POST",
      path: TAKOS_GIT_INTERNAL_PATHS.resolveSource,
      body: JSON.stringify(payload),
      actor,
      capabilities: [TAKOS_GIT_CAPABILITIES.refResolve],
    });
    return response;
  });

  for (
    const route of [
      {
        publicPath: "/api/repositories/:repositoryId/refs",
        internalPath: TAKOS_GIT_INTERNAL_PATHS.repositoryRefs,
      },
      {
        publicPath: "/api/repositories/:repositoryId/branches",
        internalPath: TAKOS_GIT_INTERNAL_PATHS.repositoryBranches,
      },
      {
        publicPath: "/api/repositories/:repositoryId/tags",
        internalPath: TAKOS_GIT_INTERNAL_PATHS.repositoryTags,
      },
      {
        publicPath: "/api/repositories/:repositoryId/tree",
        internalPath: TAKOS_GIT_INTERNAL_PATHS.repositoryTree,
      },
      {
        publicPath: "/api/repositories/:repositoryId/blob",
        internalPath: TAKOS_GIT_INTERNAL_PATHS.repositoryBlob,
      },
      {
        publicPath: "/api/repositories/:repositoryId/commits",
        internalPath: TAKOS_GIT_INTERNAL_PATHS.repositoryCommits,
      },
      {
        publicPath: "/api/repositories/:repositoryId/compare",
        internalPath: TAKOS_GIT_INTERNAL_PATHS.repositoryCompare,
      },
    ]
  ) {
    app.get(route.publicPath, async (c) => {
      const repositoryId = c.req.param("repositoryId") ?? "";
      const guard = await requireSpaceMembershipFromQuery(c);
      if (!guard.ok) return guard.response;
      const response = await forwardGitInternalRequest({
        request: c.req.raw,
        method: "GET",
        path: route.internalPath(repositoryId),
        search: new URL(c.req.raw.url).searchParams.toString(),
        body: "",
        actor: guard.actor,
        actorSpaceId: guard.spaceId,
        capabilities: [TAKOS_GIT_CAPABILITIES.repoRead],
      });
      return response;
    });
  }

  app.get("/api/repositories/:repositoryId/commits/:commitSha", async (c) => {
    const guard = await requireSpaceMembershipFromQuery(c);
    if (!guard.ok) return guard.response;
    const response = await forwardGitInternalRequest({
      request: c.req.raw,
      method: "GET",
      path: TAKOS_GIT_INTERNAL_PATHS.repositoryCommit(
        c.req.param("repositoryId"),
        c.req.param("commitSha"),
      ),
      search: new URL(c.req.raw.url).searchParams.toString(),
      body: "",
      actor: guard.actor,
      actorSpaceId: guard.spaceId,
      capabilities: [TAKOS_GIT_CAPABILITIES.repoRead],
    });
    return response;
  });

  app.get("/api/repositories/:repositoryId/pull-requests", async (c) => {
    const guard = await requireSpaceMembershipFromQuery(c);
    if (!guard.ok) return guard.response;
    const response = await forwardGitInternalRequest({
      request: c.req.raw,
      method: "GET",
      path: TAKOS_GIT_INTERNAL_PATHS.pullRequests(c.req.param("repositoryId")),
      search: new URL(c.req.raw.url).searchParams.toString(),
      body: "",
      actor: guard.actor,
      actorSpaceId: guard.spaceId,
      capabilities: [TAKOS_GIT_CAPABILITIES.prRead],
    });
    return response;
  });

  app.post("/api/repositories/:repositoryId/pull-requests", async (c) => {
    const body = await c.req.raw.text();
    const spaceId = spaceIdFromMutationBody(body, c.req.query("spaceId")) ?? "";
    if (!spaceId) {
      return c.json(
        commonError("INVALID_ARGUMENT", "spaceId is required"),
        400,
      );
    }
    const guard = await requireSpaceMembership(c, spaceId);
    if (!guard.ok) return guard.response;
    const response = await forwardGitInternalRequest({
      request: c.req.raw,
      method: "POST",
      path: TAKOS_GIT_INTERNAL_PATHS.pullRequests(c.req.param("repositoryId")),
      body,
      actor: guard.actor,
      actorSpaceId: guard.spaceId,
      capabilities: [TAKOS_GIT_CAPABILITIES.prWrite],
    });
    return response;
  });

  app.get(
    "/api/repositories/:repositoryId/pull-requests/:number",
    async (c) => {
      const guard = await requireSpaceMembershipFromQuery(c);
      if (!guard.ok) return guard.response;
      const response = await forwardGitInternalRequest({
        request: c.req.raw,
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.pullRequest(
          c.req.param("repositoryId"),
          Number(c.req.param("number")),
        ),
        body: "",
        actor: guard.actor,
        actorSpaceId: guard.spaceId,
        capabilities: [TAKOS_GIT_CAPABILITIES.prRead],
      });
      return response;
    },
  );

  app.get(
    "/api/repositories/:repositoryId/pull-requests/:number/comments",
    async (c) => {
      const guard = await requireSpaceMembershipFromQuery(c);
      if (!guard.ok) return guard.response;
      const response = await forwardGitInternalRequest({
        request: c.req.raw,
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.pullRequest(
          c.req.param("repositoryId"),
          Number(c.req.param("number")),
        ),
        body: "",
        actor: guard.actor,
        actorSpaceId: guard.spaceId,
        capabilities: [TAKOS_GIT_CAPABILITIES.prRead],
      });
      if (!response.ok) return response;
      const data = await response.json().catch(() => null) as unknown;
      const pullRequest = isRecord(data) && isRecord(data.pullRequest)
        ? data.pullRequest
        : null;
      if (!pullRequest || !Array.isArray(pullRequest.comments)) {
        return c.json(
          commonError("INTERNAL_ERROR", "invalid Git pull request response"),
          502,
        );
      }
      return c.json({ comments: pullRequest.comments });
    },
  );

  app.get(
    "/api/repositories/:repositoryId/pull-requests/:number/reviews",
    async (c) => {
      const guard = await requireSpaceMembershipFromQuery(c);
      if (!guard.ok) return guard.response;
      const response = await forwardGitInternalRequest({
        request: c.req.raw,
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.pullRequest(
          c.req.param("repositoryId"),
          Number(c.req.param("number")),
        ),
        body: "",
        actor: guard.actor,
        actorSpaceId: guard.spaceId,
        capabilities: [TAKOS_GIT_CAPABILITIES.prRead],
      });
      if (!response.ok) return response;
      const data = await response.json().catch(() => null) as unknown;
      const pullRequest = isRecord(data) && isRecord(data.pullRequest)
        ? data.pullRequest
        : null;
      if (!pullRequest || !Array.isArray(pullRequest.reviews)) {
        return c.json(
          commonError("INTERNAL_ERROR", "invalid Git pull request response"),
          502,
        );
      }
      return c.json({ reviews: pullRequest.reviews });
    },
  );

  app.get(
    "/api/repositories/:repositoryId/pull-requests/:number/diff",
    async (c) => {
      const guard = await requireSpaceMembershipFromQuery(c);
      if (!guard.ok) return guard.response;
      const response = await forwardGitInternalRequest({
        request: c.req.raw,
        method: "GET",
        path: TAKOS_GIT_INTERNAL_PATHS.pullRequestDiff(
          c.req.param("repositoryId"),
          Number(c.req.param("number")),
        ),
        body: "",
        actor: guard.actor,
        actorSpaceId: guard.spaceId,
        capabilities: [TAKOS_GIT_CAPABILITIES.prRead],
      });
      return response;
    },
  );

  app.post(
    "/api/repositories/:repositoryId/pull-requests/:number/ai-review",
    async (c) => {
      // Capability-gated git internal forward: the caller's prWrite capability
      // is checked and a known actor identity flows downstream. Membership is
      // required via spaceId query (or body fallback) so private PRs never
      // accept account-only requests.
      const body = await c.req.raw.text();
      const spaceId = spaceIdFromMutationBody(body, c.req.query("spaceId")) ??
        "";
      if (!spaceId) {
        return c.json(
          commonError("INVALID_ARGUMENT", "spaceId is required"),
          400,
        );
      }
      const guard = await requireSpaceMembership(c, spaceId);
      if (!guard.ok) return guard.response;
      const response = await forwardGitInternalRequest({
        request: c.req.raw,
        method: "POST",
        path: TAKOS_GIT_INTERNAL_PATHS.pullRequestReviews(
          c.req.param("repositoryId"),
          Number(c.req.param("number")),
        ),
        body,
        actor: guard.actor,
        actorSpaceId: guard.spaceId,
        capabilities: [TAKOS_GIT_CAPABILITIES.prWrite],
      });
      return response;
    },
  );

  app.patch(
    "/api/repositories/:repositoryId/pull-requests/:number",
    async (c) => {
      const body = await c.req.raw.text();
      const spaceId = spaceIdFromMutationBody(body, c.req.query("spaceId")) ??
        "";
      if (!spaceId) {
        return c.json(
          commonError("INVALID_ARGUMENT", "spaceId is required"),
          400,
        );
      }
      const guard = await requireSpaceMembership(c, spaceId);
      if (!guard.ok) return guard.response;
      const response = await forwardGitInternalRequest({
        request: c.req.raw,
        method: "PATCH",
        path: TAKOS_GIT_INTERNAL_PATHS.pullRequest(
          c.req.param("repositoryId"),
          Number(c.req.param("number")),
        ),
        body,
        actor: guard.actor,
        actorSpaceId: guard.spaceId,
        capabilities: [TAKOS_GIT_CAPABILITIES.prWrite],
      });
      return response;
    },
  );

  app.post(
    "/api/repositories/:repositoryId/pull-requests/:number/comments",
    async (c) => {
      const body = await c.req.raw.text();
      const spaceId = spaceIdFromMutationBody(body, c.req.query("spaceId")) ??
        "";
      if (!spaceId) {
        return c.json(
          commonError("INVALID_ARGUMENT", "spaceId is required"),
          400,
        );
      }
      const guard = await requireSpaceMembership(c, spaceId);
      if (!guard.ok) return guard.response;
      const response = await forwardGitInternalRequest({
        request: c.req.raw,
        method: "POST",
        path: TAKOS_GIT_INTERNAL_PATHS.pullRequestComments(
          c.req.param("repositoryId"),
          Number(c.req.param("number")),
        ),
        body,
        actor: guard.actor,
        actorSpaceId: guard.spaceId,
        capabilities: [TAKOS_GIT_CAPABILITIES.prWrite],
      });
      return response;
    },
  );

  app.post(
    "/api/repositories/:repositoryId/pull-requests/:number/reviews",
    async (c) => {
      const body = await c.req.raw.text();
      const spaceId = spaceIdFromMutationBody(body, c.req.query("spaceId")) ??
        "";
      if (!spaceId) {
        return c.json(
          commonError("INVALID_ARGUMENT", "spaceId is required"),
          400,
        );
      }
      const guard = await requireSpaceMembership(c, spaceId);
      if (!guard.ok) return guard.response;
      const response = await forwardGitInternalRequest({
        request: c.req.raw,
        method: "POST",
        path: TAKOS_GIT_INTERNAL_PATHS.pullRequestReviews(
          c.req.param("repositoryId"),
          Number(c.req.param("number")),
        ),
        body,
        actor: guard.actor,
        actorSpaceId: guard.spaceId,
        capabilities: [TAKOS_GIT_CAPABILITIES.prWrite],
      });
      return response;
    },
  );

  app.post(
    "/api/repositories/:repositoryId/pull-requests/:number/merge",
    async (c) => {
      // Single source of truth for the merge route: spaceId comes from the
      // request body. Falling back to the query string ambiguates the
      // authorization decision: the body says one space and the query says
      // another. We pick the body first, but require the membership check
      // before any downstream call.
      const body = await c.req.raw.text();
      const spaceId = spaceIdFromMutationBody(body, c.req.query("spaceId")) ??
        "";
      if (!spaceId) {
        return c.json(
          commonError("INVALID_ARGUMENT", "spaceId is required"),
          400,
        );
      }
      const guard = await requireSpaceMembership(c, spaceId);
      if (!guard.ok) return guard.response;
      const response = await forwardGitInternalRequest({
        request: c.req.raw,
        method: "POST",
        path: TAKOS_GIT_INTERNAL_PATHS.pullRequestMerge(
          c.req.param("repositoryId"),
          Number(c.req.param("number")),
        ),
        body,
        actor: guard.actor,
        actorSpaceId: guard.spaceId,
        capabilities: [TAKOS_GIT_CAPABILITIES.prMerge],
      });
      return response;
    },
  );
}
