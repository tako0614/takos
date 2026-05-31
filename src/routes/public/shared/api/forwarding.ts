import type { Context } from "hono";
import type { PlatformExecutionContext } from "takos-worker/shared/types";
import {
  signTakosumiInternalRequest as signTakosInternalRequest,
  TakosumiInternalClient as TakosInternalClient,
} from "takosumi-contract/internal/rpc";
import { TakosumiInternalClient } from "takosumi-contract-v2/internal/rpc";
import { TAKOS_GIT_CAPABILITIES } from "takos-git-contract";
import type { TakosumiActorContext } from "takosumi-contract-v2/internal/rpc";
import { actorFromAuthenticatedRequest } from "./auth.ts";
import type { ApiBindings } from "./bindings.ts";
import {
  commonError,
  type CommonErrorEnvelope,
  copyHeaderIfPresent,
  isRecord,
  readBodyString,
} from "./common.ts";

export type ForwardInput = {
  request: Request;
  method: string;
  path: string;
  search?: string;
  body: string;
  actor?: TakosumiActorContext;
  actorSpaceId?: string;
  capabilities?: readonly string[];
  env?: ApiBindings;
  executionCtx?: PlatformExecutionContext;
};

export type InternalServiceEndpoint = {
  serviceId: string;
  audience: string;
  url: string;
};

const INTERNAL_SERVICE_URL_ENV: Record<string, string> = {
  "takosumi": "TAKOSUMI_INTERNAL_URL",
  "takos-git": "TAKOS_GIT_INTERNAL_URL",
  "takos-agent": "TAKOS_AGENT_INTERNAL_URL",
};

export function resolveInternalServiceEndpoint(
  serviceId: string,
): InternalServiceEndpoint | undefined {
  const key = INTERNAL_SERVICE_URL_ENV[serviceId];
  const url = key ? Deno.env.get(key)?.trim() : undefined;
  if (!url) return undefined;
  return { serviceId, audience: serviceId, url };
}

export async function forwardTakosumiInternalRequest(input: ForwardInput) {
  return await forwardTakosumiRequest({
    ...input,
    serviceName: "Takosumi",
    serviceId: "takosumi",
    audience: "takosumi",
  });
}

export async function forwardGitInternalRequest(input: ForwardInput) {
  return await forwardTakosInternalRequest({
    ...input,
    serviceName: "Git",
    serviceId: "takos-git",
    audience: "takos-git",
  });
}

export async function forwardRuntimeInternalRequest(input: ForwardInput) {
  return await forwardTakosumiRequest({
    ...input,
    serviceName: "Runtime",
    serviceId: "takosumi",
    audience: "takosumi",
  });
}

export async function forwardRuntimeGatewayRequest(
  c: Context,
  publicBasePath: string,
  internalBasePath: string,
  pathSpaceId?: string,
  actor?: TakosumiActorContext,
): Promise<Response | CommonErrorEnvelope> {
  const pathname = new URL(c.req.raw.url).pathname;
  const suffix = pathname.startsWith(publicBasePath)
    ? pathname.slice(publicBasePath.length)
    : "";
  const response = await forwardRuntimeInternalRequest({
    request: c.req.raw,
    method: c.req.method,
    path: `${internalBasePath}${suffix}`,
    search: normalizedRuntimeSearch(c.req.raw, pathSpaceId),
    body: await runtimeGatewayRequestBody(c.req.raw),
    actor,
    actorSpaceId: pathSpaceId ?? runtimeSpaceIdFromRequest(c.req.raw),
    env: c.env as ApiBindings,
  });
  return response;
}

async function runtimeGatewayRequestBody(request: Request): Promise<string> {
  const method = request.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return "";
  return await request.text();
}

async function forwardTakosumiRequest(
  input: ForwardInput & {
    serviceName: string;
    serviceId: string;
    audience: string;
  },
): Promise<Response | CommonErrorEnvelope> {
  const secret = Deno.env.get("TAKOS_INTERNAL_SERVICE_SECRET");
  const endpoint = resolveInternalServiceEndpoint(input.serviceId);
  const actorResult = input.actor
    ? ({ ok: true, actor: input.actor } as const)
    : await actorFromAuthenticatedRequest(
      input.request,
      crypto.randomUUID(),
      input.actorSpaceId ?? "",
      { env: input.env, executionCtx: input.executionCtx },
    );
  if (!actorResult.ok) return actorResult.response;
  if (!secret || !endpoint) {
    return commonError(
      "INTERNAL_ERROR",
      `internal ${input.serviceName} client is not configured`,
    );
  }
  const actor = actorResult.actor;
  const client = new TakosumiInternalClient({
    caller: "takos-worker",
    audience: input.audience,
    baseUrl: endpoint.url,
    secret,
  });
  const response = await client.request({
    method: input.method,
    path: input.path,
    search: input.search,
    body: input.body,
    actor,
    capabilities: input.capabilities,
  });
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

async function forwardTakosInternalRequest(
  input: ForwardInput & {
    serviceName: string;
    serviceId: string;
    audience: string;
  },
): Promise<Response | CommonErrorEnvelope> {
  const secret = Deno.env.get("TAKOS_INTERNAL_SERVICE_SECRET");
  const endpoint = resolveInternalServiceEndpoint(input.serviceId);
  const actorResult = input.actor
    ? ({ ok: true, actor: input.actor } as const)
    : await actorFromAuthenticatedRequest(
      input.request,
      crypto.randomUUID(),
      input.actorSpaceId ?? "",
      { env: input.env, executionCtx: input.executionCtx },
    );
  if (!actorResult.ok) return actorResult.response;
  if (!secret || !endpoint) {
    return commonError(
      "INTERNAL_ERROR",
      `internal ${input.serviceName} client is not configured`,
    );
  }
  const actor = actorResult.actor;
  const client = new TakosInternalClient({
    caller: "takos-worker",
    audience: input.audience,
    baseUrl: endpoint.url,
    secret,
  });
  const response = await client.request({
    method: input.method,
    path: input.path,
    search: input.search,
    body: input.body,
    actor,
    capabilities: input.capabilities,
  });
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

export async function proxyGitSmartHttpRequest(
  request: Request,
  options: { env?: ApiBindings; executionCtx?: PlatformExecutionContext } = {},
): Promise<Response | CommonErrorEnvelope> {
  const secret = Deno.env.get("TAKOS_INTERNAL_SERVICE_SECRET");
  const endpoint = resolveInternalServiceEndpoint("takos-git");
  if (!secret || !endpoint) {
    return commonError(
      "INTERNAL_ERROR",
      "internal Git client is not configured",
    );
  }
  const url = new URL(request.url);
  const actorResult = await actorFromAuthenticatedRequest(
    request,
    crypto.randomUUID(),
    gitSpaceIdFromPath(url.pathname),
    options,
  );
  if (!actorResult.ok) return actorResult.response;
  const bodyBytes = new Uint8Array(await request.arrayBuffer());
  const signed = await signTakosInternalRequest({
    method: request.method,
    path: url.pathname,
    query: url.search,
    body: bodyBytes,
    actor: actorResult.actor,
    caller: "takos-worker",
    audience: "takos-git",
    capabilities: gitSmartHttpCapabilities(url.pathname, url.searchParams),
    timestamp: new Date().toISOString(),
    secret,
  });
  const headers = new Headers(signed.headers);
  copyHeaderIfPresent(request.headers, headers, "content-type");
  copyHeaderIfPresent(request.headers, headers, "accept");
  copyHeaderIfPresent(request.headers, headers, "git-protocol");
  const target = new URL(url.pathname, endpoint.url);
  target.search = url.search;
  const response = await fetch(target, {
    method: request.method,
    headers,
    body: bodyBytes.byteLength > 0 ? bodyBytes : undefined,
  });
  return new Response(response.body, {
    status: response.status,
    headers: response.headers,
  });
}

export const RUN_NOTIFIER_INTERNAL_HEADERS = [
  "X-Takos-Internal",
  "X-Takos-Internal-Marker",
  "X-Takos-Internal-Secret",
  "X-Takos-Auth-Proxy-Secret",
  "X-Takos-Account-Id",
  "X-Takos-Roles",
  "X-Takos-Actor-Context",
  "X-Takosumi-Actor-Context",
  "X-WS-Auth-Validated",
  "X-WS-User-Id",
] as const;

export function buildRunNotifierHeaders(
  source: HeadersInit | undefined,
  trustedOverrides: Record<string, string>,
): Record<string, string> {
  const headers = new Headers(source);
  for (const name of RUN_NOTIFIER_INTERNAL_HEADERS) headers.delete(name);
  for (const [key, value] of Object.entries(trustedOverrides)) {
    headers.set(key, value);
  }
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

export function runtimeSpaceIdFromRequest(
  request: Request,
): string | undefined {
  const params = new URL(request.url).searchParams;
  return params.get("spaceId") ?? params.get("space_id") ?? undefined;
}

export function actorSpaceIdFromPublicJsonBody(
  body: string,
): string | undefined {
  if (!body.trim()) return undefined;
  try {
    const value = JSON.parse(body) as unknown;
    if (!isRecord(value)) return undefined;
    return readBodyString(value, "space_id") ?? readBodyString(value, "space");
  } catch {
    return undefined;
  }
}

export function normalizedRuntimeSearch(
  request: Request,
  pathSpaceId?: string,
): string {
  const params = new URL(request.url).searchParams;
  const spaceId = pathSpaceId ?? params.get("spaceId") ??
    params.get("space_id");
  if (spaceId) params.set("spaceId", spaceId);
  params.delete("space_id");
  return params.toString();
}

// Git Smart HTTP service endpoints served under a `<repo>.git/` directory.
// Matching these explicitly (instead of any path containing the substring
// `.git/`) keeps the matcher anchored on the structured route shape
// `.../<repo>.git/<service>`, so an unrelated path whose segment merely ends in
// `.git` (e.g. `/api/threads/foo.git/bar`) is not misclassified as a Git
// request and granted the larger Git body-size cap.
const GIT_SMART_HTTP_SERVICE_SUFFIXES = [
  "info/refs",
  "git-upload-pack",
  "git-receive-pack",
] as const;

export function isGitSmartHttpPath(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  // Locate the repository segment (`<name>.git`). It must be a full path
  // segment ending in `.git`, not a substring within a segment value.
  const repoIndex = segments.findIndex((segment) => segment.endsWith(".git"));
  if (repoIndex === -1) return false;
  const service = segments.slice(repoIndex + 1).join("/");
  // The ref-advertisement endpoint may carry a query string in the raw path,
  // but `pathname` is already query-stripped by callers, so an exact suffix
  // match is sufficient.
  return GIT_SMART_HTTP_SERVICE_SUFFIXES.some((suffix) => service === suffix);
}

function gitSmartHttpCapabilities(
  pathname: string,
  params: URLSearchParams,
): string[] {
  if (
    pathname.endsWith("/git-receive-pack") ||
    params.get("service") === "git-receive-pack"
  ) {
    return [TAKOS_GIT_CAPABILITIES.repoWrite];
  }
  return [TAKOS_GIT_CAPABILITIES.repoRead];
}

function gitSpaceIdFromPath(pathname: string): string | undefined {
  const segments = pathname.split("/").filter(Boolean);
  const owner = segments[0] === "git" ? segments[1] : segments[0];
  return owner;
}
