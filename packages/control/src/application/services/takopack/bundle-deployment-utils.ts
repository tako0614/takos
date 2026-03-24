import type { Database } from '../../../infra/db';
import { accounts } from '../../../infra/db/schema';
import { eq } from 'drizzle-orm';
import { toIsoString } from '../../../shared/utils';

export { toIsoString } from '../../../shared/utils';

export type BundleDeploymentListRecord = {
  id: string;
  name: string;
  appId: string;
  version: string;
  description: string | null;
  icon: string | null;
  installedAt: string | Date;
  versionMajor: number;
  versionMinor: number;
  versionPatch: number;
  sourceType: string | null;
  sourceRepoId: string | null;
  sourceTag: string | null;
  sourceAssetId: string | null;
  isPinned: boolean;
  pinnedAt: string | Date | null;
  pinnedByPrincipalId: string | null;
};

export type D1BundleDeploymentListRow = {
  id: string;
  name: string;
  app_id: string;
  version: string;
  description: string | null;
  icon: string | null;
  deployed_at: string;
  version_major: number;
  version_minor: number;
  version_patch: number;
  source_type: string | null;
  source_repo_id: string | null;
  source_tag: string | null;
  source_asset_id: string | null;
  is_locked: boolean;
  locked_at: string | null;
  locked_by_principal_id: string | null;
};

export function toBundleDeploymentListItem(t: BundleDeploymentListRecord) {
  return {
    id: t.id,
    name: t.name,
    appId: t.appId,
    version: t.version,
    description: t.description,
    icon: t.icon,
    installedAt: toIsoString(t.installedAt) || '',
    versionMajor: t.versionMajor,
    versionMinor: t.versionMinor,
    versionPatch: t.versionPatch,
    sourceType: t.sourceType,
    sourceRepoId: t.sourceRepoId,
    sourceTag: t.sourceTag,
    sourceAssetId: t.sourceAssetId,
    isPinned: t.isPinned,
    pinnedAt: toIsoString(t.pinnedAt),
    pinnedBy: t.pinnedByPrincipalId,
  };
}

function normalizeInstallNamespaceSuffix(installKey: string): string {
  const suffix = installKey
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 8);
  return suffix || 'install';
}

export function buildNamespacedInfraName(baseName: string, installKey: string): string {
  return `${baseName}__${normalizeInstallNamespaceSuffix(installKey)}`;
}

export function buildDefaultBundleHostname(appId: string, installKey: string, tenantBaseDomain: string): string {
  const base = appId
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 24);
  const suffix = normalizeInstallNamespaceSuffix(installKey).slice(0, 6);
  const slug = `${base || 'app'}-${suffix}`
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 32);
  return `${slug || `app-${suffix}`}.${tenantBaseDomain}`.toLowerCase();
}

export async function getUserPrincipalId(
  db: Database,
  userId: string,
): Promise<string> {
  const account = await db.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, userId)).get();
  if (!account) {
    throw new Error('User not found');
  }
  return account.id;
}

export function hasBundleSourceChanged(params: {
  previousSourceType: string | null;
  previousSourceRepoId: string | null;
  nextSourceType?: 'git' | 'upload';
  nextSourceRepoId?: string;
}): boolean {
  const previousType = params.previousSourceType || null;
  const nextType = params.nextSourceType || null;
  if (previousType !== nextType) {
    return true;
  }

  if (previousType === 'git') {
    return (params.previousSourceRepoId || null) !== (params.nextSourceRepoId || null);
  }

  return false;
}

export type TakopackListRecord = BundleDeploymentListRecord;
export type D1TakopackListRow = D1BundleDeploymentListRow;
export const toTakopackListItem = toBundleDeploymentListItem;
