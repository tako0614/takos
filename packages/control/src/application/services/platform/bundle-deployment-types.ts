import type { InstalledTakopack } from '../takopack/dependency-resolver';
import type { BundleDeploymentListRecord } from '../takopack/bundle-deployment-utils';

/** Safely retrieve a value from a Map, throwing a descriptive error if the key is missing. */
export function getOrThrow<K, V>(map: Map<K, V>, key: K, msg: string): V {
  const v = map.get(key);
  if (v === undefined) throw new Error(msg);
  return v;
}

export type BundleDeploymentListRow = {
  id: string;
  name: string;
  appId: string;
  version: string;
  description: string | null;
  icon: string | null;
  deployedAt: string;
  versionMajor: number;
  versionMinor: number;
  versionPatch: number;
  sourceType: string | null;
  sourceRepoId: string | null;
  sourceTag: string | null;
  sourceAssetId: string | null;
  isLocked: boolean;
  lockedAt: string | null;
  lockedByAccountId: string | null;
};

export function toLegacyBundleDeploymentListRecord(row: BundleDeploymentListRow): BundleDeploymentListRecord {
  return {
    id: row.id,
    name: row.name,
    appId: row.appId,
    version: row.version,
    description: row.description,
    icon: row.icon,
    installedAt: row.deployedAt,
    versionMajor: row.versionMajor,
    versionMinor: row.versionMinor,
    versionPatch: row.versionPatch,
    sourceType: row.sourceType,
    sourceRepoId: row.sourceRepoId,
    sourceTag: row.sourceTag,
    sourceAssetId: row.sourceAssetId,
    isPinned: row.isLocked,
    pinnedAt: row.lockedAt,
    pinnedByPrincipalId: row.lockedByAccountId,
  };
}

export function toInstalledTakopack(row: {
  id: string;
  name: string;
  appId: string;
  bundleKey: string;
  version: string;
  isLocked: boolean;
  sourceType: string | null;
  sourceRepoId: string | null;
  manifestJson: string;
}): InstalledTakopack {
  return {
    id: row.id,
    name: row.name,
    appId: row.appId,
    installKey: row.bundleKey,
    version: row.version,
    isPinned: row.isLocked,
    sourceType: row.sourceType,
    sourceRepoId: row.sourceRepoId,
    manifestJson: row.manifestJson,
  };
}
