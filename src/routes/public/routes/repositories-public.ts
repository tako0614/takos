import type { Context, Hono } from "hono";
import {
  type GitResolveSourceRequest,
  TAKOS_GIT_CAPABILITIES,
  TAKOS_GIT_INTERNAL_PATHS,
} from "takos-git-contract";
import type { TakosumiActorContext } from "takosumi-contract-v2/internal/rpc";
import { actorFromAuthenticatedRequest } from "../shared/api/auth.ts";
import type { ApiBindings } from "../shared/api/bindings.ts";
import { commonError, isRecord } from "../shared/api/common.ts";
import {
  actorSpaceIdFromPublicJsonBody,
  forwardGitInternalRequest,
} from "../shared/api/forwarding.ts";
import { readSpaceMembershipRole } from "../shared/spaces/access.ts";

type MembershipGuardSuccess = {
  ok: true;
  actor: TakosumiActorContext;
  spaceId: string;
};

type MembershipGuardFailure = {
  ok: false;
  response: Response;
};

/**
 * Resolves the caller's actor identity and confirms they are a member of the
 * space identified by the `spaceId` query/body parameter. The previous code
 * passed `c.req.query("spaceId")` straight through to takos-git, which let any
 * authenticated caller spoof a tenant boundary by attaching an arbitrary
 * spaceId — IDOR. We now require a spaceId AND verify membership against
 * `account_memberships` before forwarding so the caller's actor context is
 * known-good before the signed RPC fires.
 */
async function requireSpaceMembershipFromQuery(
  c: Context<{ Bindings: ApiBindings }>,
): Promise<MembershipGuardSuccess | MembershipGuardFailure> {
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

async function requireSpaceMembership(
  c: Context<{ Bindings: ApiBindings }>,
  spaceId: string,
): Promise<MembershipGuardSuccess | MembershipGuardFailure> {
  const actorResult = await actorFromAuthenticatedRequest(
    c.req.raw,
    crypto.randomUUID(),
    spaceId,
    { env: c.env },
  );
  if (!actorResult.ok) return { ok: false, response: actorResult.response };
  const db = c.env?.DB;
  if (!db) {
    return {
      ok: false,
      response: c.json(
        commonError("INTERNAL_ERROR", "database is not configured"),
        500,
      ),
    };
  }
  const role = await readSpaceMembershipRole(
    db,
    spaceId,
    actorResult.actor.actorAccountId,
  );
  if (!role) {
    return {
      ok: false,
      response: c.json(commonError("FORBIDDEN", "forbidden"), 403),
    };
  }
  return { ok: true, actor: actorResult.actor, spaceId };
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
    if (response instanceof Response) return response;
    return c.json(response, 500);
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
    if (response instanceof Response) return response;
    return c.json(response, 500);
  });

  app.post("/api/source/resolve", async (c) => {
    const body = await c.req.json<{
      repositoryId: string;
      sourceRef: string;
      spaceId?: string;
    }>();
    const spaceId = body.spaceId?.trim() || "";
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
      repositoryId: body.repositoryId,
      sourceRef: body.sourceRef,
    };
    const response = await forwardGitInternalRequest({
      request: c.req.raw,
      method: "POST",
      path: TAKOS_GIT_INTERNAL_PATHS.resolveSource,
      body: JSON.stringify(payload),
      actor,
      capabilities: [TAKOS_GIT_CAPABILITIES.refResolve],
    });
    if (response instanceof Response) return response;
    return c.json(response, 500);
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
      if (response instanceof Response) return response;
      return c.json(response, 500);
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
    if (response instanceof Response) return response;
    return c.json(response, 500);
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
    if (response instanceof Response) return response;
    return c.json(response, 500);
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
    if (response instanceof Response) return response;
    return c.json(response, 500);
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
      if (response instanceof Response) return response;
      return c.json(response, 500);
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
      if (!(response instanceof Response)) return c.json(response, 500);
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
      if (!(response instanceof Response)) return c.json(response, 500);
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
      if (response instanceof Response) return response;
      return c.json(response, 500);
    },
  );

  app.post(
    "/api/repositories/:repositoryId/pull-requests/:number/ai-review",
    async (c) => {
      // AI review used to forward unauthenticated/unscoped through the legacy
      // upstream proxy. Replace with a capability-gated git internal forward
      // so the caller's prWrite capability is checked and a known actor
      // identity flows downstream. Membership is required via spaceId query
      // (or body fallback) — without it any account could request AI review
      // on private PRs.
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
      if (response instanceof Response) return response;
      return c.json(response, 500);
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
      if (response instanceof Response) return response;
      return c.json(response, 500);
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
      if (response instanceof Response) return response;
      return c.json(response, 500);
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
      if (response instanceof Response) return response;
      return c.json(response, 500);
    },
  );

  app.post(
    "/api/repositories/:repositoryId/pull-requests/:number/merge",
    async (c) => {
      // Single source of truth for the merge route: spaceId comes from the
      // request body. Falling back to the query string ambiguates the
      // authorization decision — the body says one space, the query says
      // another, and the legacy code happily forwarded both. We pick the
      // body first (the user submitted it explicitly), but require the
      // membership check before any downstream call.
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
      if (response instanceof Response) return response;
      return c.json(response, 500);
    },
  );
}
