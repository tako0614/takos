import {
  TAKOSUMI_ACCOUNTS_INSTALLATIONS_PATH,
  TAKOSUMI_ACCOUNTS_PLATFORM_SERVICE_CONTROL_API,
  takosumiAccountsInstallationPath,
  takosumiAccountsInstallationServiceRotateTokenPath,
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
    basePath.endsWith(TAKOSUMI_ACCOUNTS_INSTALLATIONS_PATH) &&
    normalizedPath.startsWith(`${TAKOSUMI_ACCOUNTS_INSTALLATIONS_PATH}/`)
  ) {
    url.pathname = `${basePath}${normalizedPath.slice(
      TAKOSUMI_ACCOUNTS_INSTALLATIONS_PATH.length,
    )}`;
  } else if (
    basePath.endsWith(TAKOSUMI_ACCOUNTS_INSTALLATIONS_PATH) &&
    normalizedPath === TAKOSUMI_ACCOUNTS_INSTALLATIONS_PATH
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
    TAKOSUMI_ACCOUNTS_INSTALLATIONS_PATH,
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

function serviceBaseUrlFromRotateBody(body: unknown): string | null {
  const service = readRecord(readRecord(body)?.service);
  const material = readRecord(service?.material);
  return readString(material?.baseUrl) ?? readString(service?.endpoint);
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
      takosumiAccountsInstallationPath(input.installationId),
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

  const accountsToken = readEnvString(env.TAKOSUMI_ACCOUNTS_TOKEN);
  if (!accountsToken) {
    throw new Error(
      `service binding '${params.serviceBinding.name}' requires TAKOSUMI_ACCOUNTS_TOKEN to rotate an Installation-scoped ServiceGrant token`,
    );
  }
  const response = await fetchImpl(
    accountsApiUrl(
      baseUrl,
      takosumiAccountsInstallationServiceRotateTokenPath(
        installationId,
        accountsServiceId,
      ),
    ),
    {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        authorization: `Bearer ${accountsToken}`,
      },
      body: JSON.stringify({
        scopes: params.serviceBinding.scopes ?? [],
      }),
    },
  );
  const body = await readJsonBody(response);
  if (!response.ok) {
    throw new Error(
      `service binding '${params.serviceBinding.name}' token rotation failed: ${accountsErrorMessage(
        body,
        `Accounts returned HTTP ${response.status}`,
      )}`,
    );
  }
  const record = readRecord(body);
  const token = readString(record?.token);
  if (!token) {
    throw new Error(
      `service binding '${params.serviceBinding.name}' token rotation response did not include a token`,
    );
  }
  return {
    baseUrl:
      serviceBaseUrlFromRotateBody(body) ??
      accountsInstallationBaseUrl(baseUrl),
    token,
    ...(readString(record?.expires_at)
      ? { expiresAt: readString(record?.expires_at) as string }
      : {}),
  };
};
