import type { Env } from "../../../shared/types/index.ts";
import {
  createGroupByName,
  findGroupByName,
  type GroupBackendName,
  type GroupRow,
  updateGroupMetadata,
} from "../groups/records.ts";
import type { AppManifest } from "../source/app-manifest.ts";

export function parseBackendName(
  raw: string | null | undefined,
): GroupBackendName | null {
  if (!raw) return null;
  if (
    raw === "cloudflare" || raw === "local" || raw === "aws" ||
    raw === "gcp" || raw === "k8s"
  ) {
    return raw;
  }
  return null;
}

export async function ensureGroupDeploymentSnapshotTargetGroup(
  env: Env,
  spaceId: string,
  groupName: string,
  manifest: AppManifest,
  options: {
    backendName?: GroupBackendName | null;
    envName?: string | null;
  },
): Promise<GroupRow> {
  const existing = await findGroupByName(env, spaceId, groupName);
  if (!existing) {
    return createGroupByName(env, {
      spaceId,
      groupName,
      backendName: options.backendName ?? null,
      envName: options.envName ?? null,
      appVersion: manifest.version ?? null,
      manifest,
    });
  }

  if (options.backendName !== undefined || options.envName !== undefined) {
    return updateGroupMetadata(env, existing.id, {
      ...(options.backendName !== undefined
        ? { backendName: options.backendName }
        : {}),
      ...(options.envName !== undefined ? { envName: options.envName } : {}),
    });
  }
  return existing;
}
