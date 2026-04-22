import type { Env } from "../../../../shared/types/index.ts";
import {
  createCloudflareCustomHostname,
  deleteCloudflareCustomHostname,
  getCloudflareCustomHostnameStatus,
} from "./cloudflare.ts";

export type CustomHostnameProviderName = "cloudflare" | "none";

export interface CreateCustomHostnameResult {
  success: boolean;
  provider: CustomHostnameProviderName;
  customHostnameId?: string;
  error?: string;
}

export interface CustomHostnameStatus {
  provider: CustomHostnameProviderName;
  status: string;
  sslStatus: string;
}

function normalizeProviderName(
  value: string | undefined,
): CustomHostnameProviderName | undefined {
  if (!value?.trim()) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "cloudflare") return "cloudflare";
  if (
    normalized === "none" || normalized === "off" || normalized === "disabled"
  ) {
    return "none";
  }
  throw new Error(
    `TAKOS_CUSTOM_DOMAIN_TLS_PROVIDER must be "cloudflare" or "none", got "${value}"`,
  );
}

export function resolveCustomHostnameProviderName(
  env: Pick<Env, "CF_ZONE_ID" | "TAKOS_CUSTOM_DOMAIN_TLS_PROVIDER">,
): CustomHostnameProviderName {
  const configured = normalizeProviderName(
    env.TAKOS_CUSTOM_DOMAIN_TLS_PROVIDER,
  );
  if (configured) return configured;
  return env.CF_ZONE_ID?.trim() ? "cloudflare" : "none";
}

export async function createManagedCustomHostname(
  env: Env,
  domain: string,
): Promise<CreateCustomHostnameResult> {
  const provider = resolveCustomHostnameProviderName(env);
  if (provider === "none") {
    return { success: true, provider };
  }

  const result = await createCloudflareCustomHostname(env, domain);
  return { provider, ...result };
}

export async function deleteManagedCustomHostname(
  env: Env,
  customHostnameId: string | null | undefined,
): Promise<void> {
  if (!customHostnameId) return;
  const provider = resolveCustomHostnameProviderName(env);
  if (provider === "none") return;
  await deleteCloudflareCustomHostname(env, customHostnameId);
}

export async function getManagedCustomHostnameStatus(
  env: Env,
  customHostnameId: string | null | undefined,
): Promise<CustomHostnameStatus | null> {
  if (!customHostnameId) return null;
  const provider = resolveCustomHostnameProviderName(env);
  if (provider === "none") return null;
  const status = await getCloudflareCustomHostnameStatus(env, customHostnameId);
  return status ? { provider, ...status } : null;
}
