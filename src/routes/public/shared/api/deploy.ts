import { actorFromAuthenticatedRequest } from "./auth.ts";
import type { ApiBindings } from "./bindings.ts";
import {
  commonError,
  isRecord,
  parseJsonObjectOrNull,
  readBodyString,
  resolveRequestIdFromHeaders,
} from "./common.ts";
import { retiredTakosDeploymentProxyResponse } from "./retired.ts";

export const APP_INSTALLATION_BINDING_KINDS = [
  "identity.oidc@v1",
  "database.postgres@v1",
  "object-store.s3-compatible@v1",
  "domain.http@v1",
  "install-launch-token@v1",
] as const;

export type AppInstallationBindingKind =
  typeof APP_INSTALLATION_BINDING_KINDS[number];

export type AppInstallationBindingRecord = {
  name: string;
  kind: AppInstallationBindingKind;
  config_ref: string;
  secret_refs: string[];
};

export function normalizeAppInstallationBindings(
  value: unknown,
): AppInstallationBindingRecord[] | Response {
  if (!Array.isArray(value) || value.length < 1 || value.length > 32) {
    return Response.json(
      commonError("INVALID_ARGUMENT", "bindings must contain 1-32 entries"),
      { status: 400 },
    );
  }
  const seen = new Set<string>();
  const bindings: AppInstallationBindingRecord[] = [];
  for (const [index, binding] of value.entries()) {
    if (!isRecord(binding)) {
      return Response.json(
        commonError("INVALID_ARGUMENT", `bindings[${index}] must be an object`),
        { status: 400 },
      );
    }
    const name = readBodyString(binding, "name");
    const kind = appBindingKindValue(binding.kind ?? binding.type);
    const configRef = readBodyString(binding, "config_ref") ??
      readBodyString(binding, "configRef");
    const secretRefs = appBindingSecretRefs(binding);
    if (!name || !/^[a-z]([a-z0-9-]{0,30}[a-z0-9])?$/.test(name)) {
      return Response.json(
        commonError("INVALID_ARGUMENT", `bindings[${index}].name is invalid`),
        { status: 400 },
      );
    }
    if (seen.has(name)) {
      return Response.json(
        commonError("INVALID_ARGUMENT", `duplicate binding name: ${name}`),
        { status: 400 },
      );
    }
    if (!kind) {
      return Response.json(
        commonError("INVALID_ARGUMENT", `bindings[${index}].kind is invalid`),
        { status: 400 },
      );
    }
    if (!configRef) {
      return Response.json(
        commonError(
          "INVALID_ARGUMENT",
          `bindings[${index}].config_ref is required`,
        ),
        { status: 400 },
      );
    }
    if (!secretRefs) {
      return Response.json(
        commonError(
          "INVALID_ARGUMENT",
          `bindings[${index}].secret_refs must be an array of strings`,
        ),
        { status: 400 },
      );
    }
    seen.add(name);
    bindings.push({
      name,
      kind,
      config_ref: configRef,
      secret_refs: secretRefs,
    });
  }
  return bindings;
}

function appBindingKindValue(
  value: unknown,
): AppInstallationBindingKind | null {
  return typeof value === "string" &&
      (APP_INSTALLATION_BINDING_KINDS as readonly string[]).includes(value)
    ? value as AppInstallationBindingKind
    : null;
}

function appBindingSecretRefs(
  binding: Record<string, unknown>,
): string[] | null {
  const value = binding.secret_refs ?? binding.secretRefs ?? [];
  return Array.isArray(value) &&
      value.every((entry) => typeof entry === "string")
    ? value
    : null;
}

const RETIRED_INLINE_WORKFLOW_DEPLOY_GUIDANCE =
  'source.kind="inline" workflow artifact deploys are retired. ' +
  "Deploy via Takosumi: register the Git OpenTofu module as an Installation, " +
  "then run plan/apply through Takosumi (PlanRun/ApplyRun); the recorded " +
  "Deployment/DeploymentOutput is the result.";

export function retiredInlineWorkflowDeploymentResponse(
  body: string,
): Response | null {
  const value = parseJsonObjectOrNull(body);
  if (!value) return null;
  const source = value.source;
  if (!isRecord(source) || source.kind !== "inline") return null;
  if (hasRetiredInlineWorkflowArtifact(source)) {
    return Response.json(
      commonError("INVALID_ARGUMENT", RETIRED_INLINE_WORKFLOW_DEPLOY_GUIDANCE),
      { status: 400 },
    );
  }
  return null;
}

export async function maybeWriteGitOpsDeploymentIntent(
  request: Request,
  body: string,
  actorSpaceId?: string,
  env?: ApiBindings,
): Promise<Response> {
  const value = parseJsonObjectOrNull(body);
  if (!value) {
    return Response.json(
      commonError("INVALID_ARGUMENT", "deployment request body must be JSON"),
      { status: 400 },
    );
  }

  // Authenticate before returning the retired response so unauthenticated
  // callers cannot probe backend deployment configuration by status code.
  const actorResult = await actorFromAuthenticatedRequest(
    request,
    resolveRequestIdFromHeaders(request.headers),
    actorSpaceId,
    { env },
  );
  if (!actorResult.ok) return actorResult.response;

  void value;
  return retiredTakosDeploymentProxyResponse();
}

function hasRetiredInlineWorkflowArtifact(
  source: Record<string, unknown>,
): boolean {
  const artifacts = source.artifacts;
  return Array.isArray(artifacts) &&
    artifacts.some((artifact) =>
      isRecord(artifact) && isRecord(artifact.workflow)
    );
}
