import type { Env } from "../../../shared/types/index.ts";
import {
  createGroupByName,
  findGroupByName,
  type GroupProviderName,
  type GroupRow,
  updateGroupMetadata,
} from "../groups/records.ts";
import type { AppManifest } from "../source/app-manifest.ts";

export function parseProviderName(
  raw: string | null | undefined,
): GroupProviderName | null {
  if (!raw) return null;
  if (
    raw === "cloudflare" || raw === "local" || raw === "aws" ||
    raw === "gcp" || raw === "k8s"
  ) {
    return raw;
  }
  return null;
}

export function resolveDefaultGroupName(manifest: AppManifest): string {
  return manifest.metadata.name;
}

export async function ensureAppDeploymentTargetGroup(
  env: Env,
  spaceId: string,
  groupName: string,
  manifest: AppManifest,
  options: {
    providerName?: GroupProviderName | null;
    envName?: string | null;
  },
): Promise<GroupRow> {
  const existing = await findGroupByName(env, spaceId, groupName);
  if (!existing) {
    return createGroupByName(env, {
      spaceId,
      groupName,
      provider: options.providerName ?? null,
      envName: options.envName ?? null,
      appVersion: manifest.spec.version ?? null,
      manifest,
    });
  }

  if (options.providerName !== undefined || options.envName !== undefined) {
    return updateGroupMetadata(env, existing.id, {
      ...(options.providerName !== undefined
        ? { provider: options.providerName }
        : {}),
      ...(options.envName !== undefined ? { envName: options.envName } : {}),
    });
  }
  return existing;
}
