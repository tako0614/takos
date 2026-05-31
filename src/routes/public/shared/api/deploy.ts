import {
  createDeployIntentClient,
  parseDeployIntentEnv,
} from "@takos/deploy-intent";
import { actorFromAuthenticatedRequest } from "./auth.ts";
import type { ApiBindings } from "./bindings.ts";
import {
  commonError,
  isRecord,
  parseJsonObjectOrNull,
  readBodyString,
} from "./common.ts";
import { retiredTakosDeploymentProxyResponse } from "./retired.ts";

export const APP_INSTALLATION_BINDING_KINDS = [
  "identity.oidc@v1",
  "database.postgres@v1",
  "object-store.s3-compatible@v1",
  "domain.http@v1",
  "deploy-intent.gitops@v1",
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
  "Use `takosumi init`, then `takosumi install dry-run/apply` to build and submit " +
  "worker artifacts, or submit an AppSpec through the GitOps deploy intent API.";

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
  if (requestedDeployIntentMode(value) === "unmanaged") {
    return retiredTakosDeploymentProxyResponse();
  }
  const requestMode = readBodyString(value, "mode") ?? "apply";
  if (requestMode !== "apply") {
    return retiredTakosDeploymentProxyResponse();
  }

  // Authenticate BEFORE inspecting deploy-intent configuration or validating
  // the AppSpec, so unauthenticated callers cannot probe whether GitOps deploy
  // is configured (503 vs 202) or learn config-shape details from validation
  // errors. Pre-auth responses must not vary on backend configuration.
  const requestId = crypto.randomUUID();
  const actorResult = await actorFromAuthenticatedRequest(
    request,
    requestId,
    actorSpaceId,
    { env },
  );
  if (!actorResult.ok) return actorResult.response;

  let config;
  try {
    config = parseDeployIntentEnv(Deno.env.toObject());
  } catch {
    // Do not surface the raw parse error.message: it can echo back env-derived
    // configuration detail. The operator finds the cause in server logs.
    console.error(
      `[deploy-intent] config parse failed (requestId=${requestId})`,
    );
    return Response.json(
      commonError(
        "INTERNAL_ERROR",
        "deploy intent config is invalid",
      ),
      { status: 500 },
    );
  }
  if (!config) {
    return Response.json(
      commonError(
        "DEPLOY_INTENT_NOT_CONFIGURED",
        "GitOps deploy intent is not configured for this Takos installation.",
      ),
      { status: 503 },
    );
  }

  if (!isAppSpecEnvelope(value.appSpec)) {
    return Response.json(
      commonError(
        "INVALID_ARGUMENT",
        "gitops deploy intent requires an AppSpec (`apiVersion: v1`, `metadata`, `components`); root `kind:` field is rejected (= Wave K); legacy `apiVersion: takosumi.dev/v1` is rejected (= Wave L)",
      ),
      { status: 400 },
    );
  }

  const id = `deploy-${crypto.randomUUID()}`;
  try {
    const result = await createDeployIntentClient({ config }).write({
      id,
      mode: "apply",
      appSpec: value.appSpec,
      metadata: {
        requestId,
        actorAccountId: actorResult.actor.actorAccountId,
        ...(actorSpaceId ? { spaceId: actorSpaceId } : {}),
        ...(readBodyString(value, "group")
          ? { group: readBodyString(value, "group") }
          : {}),
        ...(readBodyString(value, "target_id")
          ? { targetId: readBodyString(value, "target_id") }
          : {}),
      },
      message: `Deploy intent ${id}`,
    });
    return Response.json({
      accepted: true,
      mode: "gitops",
      intent: {
        id,
        driver: result.driver,
        branch: result.branch,
        path: result.path,
        commit: result.commit,
      },
    }, { status: 202 });
  } catch (error) {
    // Do not surface the raw error.message: runGit embeds git stderr, which
    // can echo the deploy remote URL, repo paths, and server-side git error
    // detail. The operator finds the cause in server logs.
    console.error(
      `[deploy-intent] write failed (requestId=${requestId})`,
      error,
    );
    return Response.json(
      commonError("INTERNAL_ERROR", "failed to write gitops deploy intent"),
      { status: 502 },
    );
  }
}

function requestedDeployIntentMode(
  body: Record<string, unknown>,
): "gitops" | "unmanaged" | undefined {
  const value = body.deploy_intent ?? body.deployIntent;
  if (!isRecord(value)) return undefined;
  return value.mode === "gitops" || value.mode === "unmanaged"
    ? value.mode
    : undefined;
}

function isAppSpecEnvelope(
  value: unknown,
): value is Record<string, unknown> {
  // Wave K (= AppSpec root envelope minimization): root `kind:` field is
  // no longer accepted. `apiVersion` alone discriminates the schema.
  // Input with `kind:` at root is rejected fail-closed (= same shape as
  // takosumi installer parser unknown-key reject).
  // Wave L (= apiVersion group prefix minimization): plain `v1` is the
  // canonical literal. Legacy `takosumi.dev/v1` is rejected fail-closed
  // (= same shape as takosumi installer parser).
  if (
    !isRecord(value) || value.apiVersion !== "v1" ||
    "kind" in value
  ) {
    return false;
  }
  const metadata = value.metadata;
  return isRecord(metadata) &&
    typeof metadata.id === "string" &&
    typeof metadata.name === "string" &&
    isRecord(value.components);
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
