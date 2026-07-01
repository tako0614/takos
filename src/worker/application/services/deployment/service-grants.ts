import {
  TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH,
  TAKOSUMI_ACCOUNTS_PLATFORM_SERVICE_CONTROL_API,
  takosumiAccountsCapsulePath,
} from "@takosjp/takosumi-accounts-contract";

import type { Env } from "../../../shared/types/env.ts";
import { SERVICE_GRAPH_CAPABILITIES } from "../source/app-interface-contract.ts";
import type { AppServiceBinding } from "../source/app-manifest-types.ts";

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
    readEnvString(env.TAKOSUMI_ACCOUNTS_ISSUER)
  );
}

function accountsApiUrl(baseUrl: string, path: string): URL {
  const url = new URL(baseUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  if (
    basePath.endsWith(TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH) &&
    normalizedPath.startsWith(`${TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH}/`)
  ) {
    url.pathname = `${basePath}${normalizedPath.slice(
      TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH.length,
    )}`;
  } else if (
    basePath.endsWith(TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH) &&
    normalizedPath === TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH
  ) {
    url.pathname = basePath;
  } else {
    url.pathname = `${basePath}${normalizedPath}`;
  }
  url.search = "";
  return url;
}

function accountsInstallationBaseUrl(baseUrl: string): string {
  return accountsApiUrl(
    baseUrl,
    TAKOSUMI_ACCOUNTS_CAPSULE_PROJECTIONS_PATH,
  ).toString();
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

function accountsErrorMessage(body: unknown, fallback: string): string {
  const record = readRecord(body);
  const error = readRecord(record?.error);
  return (
    readString(record?.error_description) ??
    readString(record?.message) ??
    readString(error?.message) ??
    readString(error?.code) ??
    readString(record?.error) ??
    fallback
  );
}

function accountsServiceIdForCapability(
  serviceBinding: AppServiceBinding,
): string {
  if (serviceBinding.capability === SERVICE_GRAPH_CAPABILITIES.controlApi) {
    return TAKOSUMI_ACCOUNTS_PLATFORM_SERVICE_CONTROL_API;
  }
  throw new Error(
    `service binding '${serviceBinding.name}' (${serviceBinding.capability}) is not supported by this materializer`,
  );
}

async function previousTokenIsCurrent(input: {
  fetchImpl: typeof fetch;
  baseUrl: string;
  installationId: string;
  previousToken: string;
}): Promise<boolean> {
  const response = await input.fetchImpl(
    accountsApiUrl(
      input.baseUrl,
      takosumiAccountsCapsulePath(input.installationId),
    ),
    {
      method: "GET",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${input.previousToken}`,
      },
    },
  );
  if (response.ok) return true;
  if (response.status === 401 || response.status === 403) return false;
  const body = await readJsonBody(response);
  throw new Error(
    `service binding token validation failed: ${accountsErrorMessage(
      body,
      `Accounts returned HTTP ${response.status}`,
    )}`,
  );
}

export const materializeTakosumiServiceGrant: ServiceGrantMaterializer = async (
  env,
  params,
) => {
  const accountsServiceId = accountsServiceIdForCapability(
    params.serviceBinding,
  );
  const installationId = readEnvString(params.installationId);
  if (!installationId) {
    throw new Error(
      `service binding '${params.serviceBinding.name}' (${params.serviceBinding.capability}) targets compute '${params.workloadName}' but no Takosumi Accounts Installation id is available`,
    );
  }
  const baseUrl = accountsBaseUrl(env);
  if (!baseUrl) {
    throw new Error(
      `service binding '${params.serviceBinding.name}' requires TAKOSUMI_ACCOUNTS_INTERNAL_URL, TAKOSUMI_ACCOUNTS_URL, or TAKOSUMI_ACCOUNTS_ISSUER`,
    );
  }

  // Reference the resolved platform service id so the capability check is
  // exercised even though token minting is no longer available in OSS.
  void accountsServiceId;
  const fetchImpl = fetch;
  const previousToken = readEnvString(params.previousToken);
  if (previousToken) {
    const isCurrent = await previousTokenIsCurrent({
      fetchImpl,
      baseUrl,
      installationId,
      previousToken,
    });
    if (isCurrent) {
      return {
        baseUrl: accountsInstallationBaseUrl(baseUrl),
        token: previousToken,
      };
    }
  }

  // Deploy decision D3: Takosumi OSS removed the Service Graph service-token
  // issuance (the `/installations/{id}/services/{serviceId}/rotate-token`
  // endpoint). A `control.api` ServiceGrant token can therefore only be REUSED
  // (validated above), not minted, against an OSS control plane. Operators that
  // need control.api token vending use Takosumi Cloud. Fail closed here rather
  // than silently calling a removed endpoint.
  throw new Error(
    `service binding '${params.serviceBinding.name}' (${params.serviceBinding.capability}) cannot mint a new ServiceGrant token: Takosumi OSS removed Service Graph service-token issuance. Supply a current token via previousToken, or use Takosumi Cloud.`,
  );
};
