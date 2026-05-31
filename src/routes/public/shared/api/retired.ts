import { commonError, pathMatchesPrefix } from "./common.ts";

const RETIRED_OAUTH_PUBLIC_API_PREFIX = "/api/public/v1/oauth";
const RETIRED_OAUTH_PREFIX = "/oauth";
const RETIRED_OAUTH_CONSENT_API_PREFIX = "/api/oauth";
const RETIRED_BILLING_PREFIXES = [
  "/api/billing",
  "/api/internal/v1/billing",
] as const;
const RETIRED_PUBLICATIONS_PREFIX = "/api/publications";
const RETIRED_OAUTH_WELL_KNOWN_PATHS = new Set([
  "/.well-known/oauth-authorization-server",
  "/.well-known/openid-configuration",
  "/.well-known/jwks.json",
]);

export const CONTROL_ROUTE_API_PREFIXES = [
  "/api/repos",
  "/api/git",
  "/api/memories",
  "/api/reminders",
  "/api/skills",
  "/api/apps",
  "/api/agent-tasks",
  "/api/shortcuts",
  "/api/notifications",
  "/api/events",
  "/api/mcp",
  "/api/public/thread-shares",
  "/api/public/stores",
] as const;

export const CONTROL_ROUTE_SPACE_FAMILIES = new Set([
  "agent-tasks",
  "app-installations",
  "graph",
  "index",
  "managed-skills",
  "members",
  "memories",
  "model",
  "reminders",
  "repos",
  "repositories",
  "search",
  "shortcuts",
  "skills",
  "storage",
  "store-registry",
  "stores",
]);

export const RETIRED_PUBLIC_DEPLOYMENT_PATHS = {
  deployments: "/api/public/v1/deployments",
  deployment: "/api/public/v1/deployments/:deploymentId",
  deploymentApply: "/api/public/v1/deployments/:deploymentId/apply",
  deploymentApprove: "/api/public/v1/deployments/:deploymentId/approve",
  deploymentObservations:
    "/api/public/v1/deployments/:deploymentId/observations",
  groupHead: "/api/public/v1/groups/:groupId/head",
  groupRollback: "/api/public/v1/groups/:groupId/rollback",
} as const;

export function isRetiredTakosOAuthProviderPath(pathname: string): boolean {
  return pathname === RETIRED_OAUTH_PUBLIC_API_PREFIX ||
    pathname.startsWith(`${RETIRED_OAUTH_PUBLIC_API_PREFIX}/`) ||
    pathname === RETIRED_OAUTH_PREFIX ||
    pathname.startsWith(`${RETIRED_OAUTH_PREFIX}/`) ||
    pathname === RETIRED_OAUTH_CONSENT_API_PREFIX ||
    pathname.startsWith(`${RETIRED_OAUTH_CONSENT_API_PREFIX}/`) ||
    RETIRED_OAUTH_WELL_KNOWN_PATHS.has(pathname);
}

export function isRetiredTakosBillingPath(pathname: string): boolean {
  return RETIRED_BILLING_PREFIXES.some((prefix) =>
    pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function isRetiredTakosPublicationsPath(pathname: string): boolean {
  return pathname === RETIRED_PUBLICATIONS_PREFIX ||
    pathname.startsWith(`${RETIRED_PUBLICATIONS_PREFIX}/`);
}

export function isControlRouteFamilyPath(pathname: string): boolean {
  if (
    CONTROL_ROUTE_API_PREFIXES.some((prefix) =>
      pathMatchesPrefix(pathname, prefix)
    )
  ) {
    return true;
  }

  const parts = pathname.split("/").filter(Boolean);
  return parts.length >= 4 &&
    parts[0] === "api" &&
    parts[1] === "spaces" &&
    CONTROL_ROUTE_SPACE_FAMILIES.has(parts[3]);
}

export function retiredTakosOAuthProviderResponse(): Response {
  return Response.json(
    commonError(
      "NOT_FOUND",
      "Takos OAuth provider routes are not exposed by Takos.",
    ),
    { status: 404 },
  );
}

export function retiredTakosPublicationsResponse(): Response {
  return Response.json(
    commonError(
      "NOT_FOUND",
      "Takos publications routes are not exposed by Takos.",
    ),
    { status: 404 },
  );
}

export function retiredTakosDeploymentProxyResponse(): Response {
  return Response.json(
    commonError(
      "GONE",
      "Takos app no longer proxies direct Takosumi deployment APIs. Write a GitOps deploy intent from Takos, or use takosumi deploy for unmanaged kernel deploys.",
    ),
    { status: 410 },
  );
}

export function retiredTakosBillingResponse(): Response {
  return Response.json(
    commonError(
      "GONE",
      "Takos billing routes are retired. Use Takosumi Accounts billing surfaces.",
    ),
    { status: 410 },
  );
}
