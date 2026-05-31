import {
  decodeActorContext,
  TAKOSUMI_INTERNAL_ACTOR_HEADER as TAKOS_INTERNAL_ACTOR_HEADER,
  TAKOSUMI_INTERNAL_AUDIENCE_HEADER as TAKOS_INTERNAL_AUDIENCE_HEADER,
  TAKOSUMI_INTERNAL_CALLER_HEADER as TAKOS_INTERNAL_CALLER_HEADER,
  TAKOSUMI_INTERNAL_CAPABILITIES_HEADER as TAKOS_INTERNAL_CAPABILITIES_HEADER,
  TAKOSUMI_INTERNAL_SIGNATURE_HEADER as TAKOS_INTERNAL_SIGNATURE_HEADER,
  TAKOSUMI_INTERNAL_TIMESTAMP_HEADER as TAKOS_INTERNAL_TIMESTAMP_HEADER,
  type TakosumiActorContext as TakosActorContext,
  type VerifiedTakosumiInternalRpc as VerifiedTakosInternalRpc,
  verifyTakosumiInternalRequestFromHeaders
    as verifyTakosInternalRequestFromHeaders,
} from "takosumi-contract/internal/rpc";
import { TAKOS_GIT_CAPABILITIES } from "takos-git-contract";
import { getEnv } from "./runtime.ts";

const TAKOS_GIT_EXPECTED_AUDIENCE = "takos-git";
const TAKOS_GIT_DEFAULT_INTERNAL_CALLERS = [
  "takos-worker",
  "takosumi",
  "takos-agent",
];

export function readInternalAuth(
  request: Request,
): Promise<TakosGitInternalAuth | { ok: false; error: string }> {
  const secret = getEnv("TAKOS_INTERNAL_SERVICE_SECRET");
  return readInternalAuthWithSecret(request, secret);
}

export type TakosGitInternalAuth = { ok: true } & VerifiedTakosInternalRpc;

export type RepositoryAccess = "read" | "write";

export function canAccessRepositoryOwner(
  auth: TakosGitInternalAuth,
  ownerSpaceId: string,
  access: RepositoryAccess,
): boolean {
  if (auth.actor.spaceId !== ownerSpaceId) return false;
  if (access === "read") return true;
  return hasWriteRole(auth.actor);
}

export function repositoryAccessDenied(repositoryId: string) {
  return {
    error: "repository access denied",
    code: "git_repository_access_denied",
    repositoryId,
  };
}

async function readInternalAuthWithSecret(
  request: Request,
  secret: string | undefined,
): Promise<TakosGitInternalAuth | { ok: false; error: string }> {
  if (!secret) return { ok: false, error: "internal service secret missing" };
  const signature = request.headers.get(TAKOS_INTERNAL_SIGNATURE_HEADER);
  if (!signature) {
    return { ok: false, error: "missing internal signature" };
  }
  const timestamp = request.headers.get(TAKOS_INTERNAL_TIMESTAMP_HEADER);
  if (!timestamp) {
    return { ok: false, error: "missing internal timestamp" };
  }
  const actorHeader = request.headers.get(TAKOS_INTERNAL_ACTOR_HEADER);
  if (!actorHeader) return { ok: false, error: "missing actor context" };
  let actor: TakosActorContext;
  try {
    actor = decodeActorContext(actorHeader);
  } catch {
    return { ok: false, error: "invalid actor context" };
  }
  const caller = request.headers.get(TAKOS_INTERNAL_CALLER_HEADER);
  if (!caller) return { ok: false, error: "missing internal caller" };
  if (!allowedInternalCallers().includes(caller)) {
    return { ok: false, error: "invalid internal caller" };
  }
  const audience = request.headers.get(TAKOS_INTERNAL_AUDIENCE_HEADER);
  if (!audience) return { ok: false, error: "missing internal audience" };
  const requiredCapabilities = requiredGitCapabilities(request);
  if (requiredCapabilities.length > 0) {
    const capabilities = request.headers.get(
      TAKOS_INTERNAL_CAPABILITIES_HEADER,
    );
    if (!capabilities) {
      return { ok: false, error: "missing internal capability" };
    }
  }
  const body = new Uint8Array(await request.clone().arrayBuffer());
  const url = new URL(request.url);
  const verified = await verifyTakosInternalRequestFromHeaders({
    method: request.method,
    path: url.pathname,
    query: url.search,
    body,
    secret,
    headers: request.headers,
    expectedCaller: allowedInternalCallers(),
    expectedAudience: TAKOS_GIT_EXPECTED_AUDIENCE,
    requiredCapabilities,
  });
  if (!verified) return { ok: false, error: "invalid internal signature" };
  return { ok: true, ...verified, actor };
}

function allowedInternalCallers(): string[] {
  const configured = getEnv("TAKOS_GIT_INTERNAL_CALLERS");
  return (configured?.split(",") ?? TAKOS_GIT_DEFAULT_INTERNAL_CALLERS)
    .map((caller) => caller.trim())
    .filter(Boolean);
}

function requiredGitCapabilities(request: Request): string[] {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method.toUpperCase();
  if (isReceivePack(path, url.searchParams)) {
    return [TAKOS_GIT_CAPABILITIES.repoWrite];
  }
  if (isUploadPack(path, url.searchParams)) {
    return [TAKOS_GIT_CAPABILITIES.repoRead];
  }
  if (path.startsWith("/internal/objects/")) {
    return [TAKOS_GIT_CAPABILITIES.objectRead];
  }
  if (path === "/internal/source/resolve") {
    return [TAKOS_GIT_CAPABILITIES.refResolve];
  }
  if (path === "/internal/source/snapshot") {
    return [TAKOS_GIT_CAPABILITIES.sourceSnapshot];
  }
  if (
    path === "/internal/repositories/import-external" ||
    path.endsWith("/fetch-external")
  ) {
    return [TAKOS_GIT_CAPABILITIES.repoImport];
  }
  if (path.includes("/pull-requests")) {
    if (method === "GET") return [TAKOS_GIT_CAPABILITIES.prRead];
    if (path.endsWith("/merge")) return [TAKOS_GIT_CAPABILITIES.prMerge];
    return [TAKOS_GIT_CAPABILITIES.prWrite];
  }
  if (path.includes("/refs")) {
    return [TAKOS_GIT_CAPABILITIES.repoRead];
  }
  if (path.startsWith("/internal/repositories")) {
    return method === "GET"
      ? [TAKOS_GIT_CAPABILITIES.repoRead]
      : [TAKOS_GIT_CAPABILITIES.repoWrite];
  }
  return [];
}

function isUploadPack(path: string, params: URLSearchParams): boolean {
  return path.endsWith("/git-upload-pack") ||
    params.get("service") === "git-upload-pack";
}

function isReceivePack(path: string, params: URLSearchParams): boolean {
  return path.endsWith("/git-receive-pack") ||
    params.get("service") === "git-receive-pack";
}

function hasWriteRole(actor: TakosActorContext): boolean {
  return actor.roles.some((role) =>
    ["owner", "admin", "maintainer", "write"].includes(role)
  );
}
