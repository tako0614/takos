import type { Env } from "../../../shared/types/env.ts";
import { RUNTIME_PROJECTION_CAPABILITIES } from "../source/app-interface-contract.ts";
import type { AppServiceBinding } from "../source/app-manifest-types.ts";
import { takosumiSessionApiUrl } from "../takosumi-control-paths.ts";

export type ServiceGrantMaterialization = {
  baseUrl: string;
  token: string;
  expiresAt?: string;
};

export type ServiceGrantMaterializer = (
  env: Env,
  params: {
    spaceId: string;
    installationId?: string | null;
    workloadName: string;
    serviceBinding: AppServiceBinding;
    previousToken?: string | null;
  },
) => Promise<ServiceGrantMaterialization>;

export const serviceGrantDeps = {
  fetch: (input: string | URL | Request, init?: RequestInit) =>
    fetch(input, init),
};

function readEnvString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function accountsBaseUrl(env: Env): string | null {
  return (
    readEnvString(env.TAKOSUMI_ACCOUNTS_INTERNAL_URL) ??
    readEnvString(env.TAKOSUMI_ACCOUNTS_URL) ??
    readEnvString(env.OIDC_ISSUER_URL)
  );
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function assertSupportedBinding(serviceBinding: AppServiceBinding): void {
  if (
    serviceBinding.capability !== RUNTIME_PROJECTION_CAPABILITIES.controlApi
  ) {
    throw new Error(
      `service binding '${serviceBinding.name}' (${serviceBinding.capability}) is not supported by this materializer`,
    );
  }
}

function scopeSet(value: unknown): Set<string> {
  return new Set((readString(value) ?? "").split(/\s+/u).filter(Boolean));
}

function isCurrentInterfaceToken(
  body: unknown,
  expected: {
    workspaceId: string;
    capsuleId: string;
    resource: string;
    permissions: readonly string[];
  },
): boolean {
  const record = readRecord(body);
  const takosumi = readRecord(record?.takosumi);
  const resolvedRevision = takosumi?.interface_resolved_revision;
  const permissions = scopeSet(record?.scope);
  return Boolean(
    record?.active === true &&
    record?.token_use === "interface_oauth" &&
    readString(record.aud) === expected.resource &&
    readString(takosumi?.workspace_id) === expected.workspaceId &&
    readString(takosumi?.capsule_id) === expected.capsuleId &&
    readString(takosumi?.interface_id) &&
    readString(takosumi?.interface_binding_id) &&
    typeof resolvedRevision === "number" &&
    Number.isInteger(resolvedRevision) &&
    resolvedRevision >= 0 &&
    expected.permissions.every((permission) => permissions.has(permission)),
  );
}

async function previousTokenIsCurrent(input: {
  baseUrl: string;
  clientId: string;
  clientSecret: string;
  workspaceId: string;
  capsuleId: string;
  permissions: readonly string[];
  previousToken: string;
}): Promise<{ current: boolean; resource: string }> {
  const resource = takosumiSessionApiUrl(input.baseUrl, "/api/v1").toString();
  const response = await serviceGrantDeps.fetch(
    takosumiSessionApiUrl(input.baseUrl, "/oauth/introspect"),
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        token: input.previousToken,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        resource,
      }),
    },
  );
  if (!response.ok) {
    throw new Error(
      `canonical Interface token introspection failed with HTTP ${response.status}`,
    );
  }
  return {
    current: isCurrentInterfaceToken(await readJsonBody(response), {
      workspaceId: input.workspaceId,
      capsuleId: input.capsuleId,
      resource,
      permissions: input.permissions,
    }),
    resource,
  };
}

export const materializeTakosumiServiceGrant: ServiceGrantMaterializer = async (
  env,
  params,
) => {
  assertSupportedBinding(params.serviceBinding);
  const capsuleId = readEnvString(params.installationId);
  if (!capsuleId) {
    throw new Error(
      `service binding '${params.serviceBinding.name}' (${params.serviceBinding.capability}) targets compute '${params.workloadName}' but no canonical Capsule id is available`,
    );
  }
  const baseUrl = accountsBaseUrl(env);
  if (!baseUrl) {
    throw new Error(
      `service binding '${params.serviceBinding.name}' requires TAKOSUMI_ACCOUNTS_INTERNAL_URL, TAKOSUMI_ACCOUNTS_URL, or OIDC_ISSUER_URL`,
    );
  }
  const clientId = readEnvString(env.OIDC_CLIENT_ID);
  const clientSecret = readEnvString(env.OIDC_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    throw new Error(
      `service binding '${params.serviceBinding.name}' requires confidential OIDC client credentials for Interface token introspection`,
    );
  }
  const previousToken = readEnvString(params.previousToken);
  if (previousToken) {
    const validation = await previousTokenIsCurrent({
      baseUrl,
      clientId,
      clientSecret,
      workspaceId: params.spaceId,
      capsuleId,
      permissions: params.serviceBinding.scopes,
      previousToken,
    });
    if (validation.current) {
      return { baseUrl: validation.resource, token: previousToken };
    }
  }

  // Runtime authority is owned by a current Interface + InterfaceBinding.
  // This deploy reconciler has no Principal authorization context with which to
  // request a replacement token, so it may only reuse a fully introspected
  // short-lived credential and otherwise must fail closed.
  throw new Error(
    `service binding '${params.serviceBinding.name}' (${params.serviceBinding.capability}) cannot mint a canonical Interface token. Supply a current, exactly scoped Interface OAuth token via previousToken.`,
  );
};
