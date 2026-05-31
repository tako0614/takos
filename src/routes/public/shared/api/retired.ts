import { commonError } from "./common.ts";

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
