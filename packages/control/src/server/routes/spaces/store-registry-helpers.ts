import type { D1Database } from "../../../shared/types/bindings.ts";
import { NotFoundError } from "takos-common/errors";
import { requireSpaceAccess } from "../route-auth.ts";
import {
  addRemoteStore,
  getRegistryEntry,
  listRegisteredStores,
  refreshRemoteStore,
  removeRemoteStore,
  setActiveStore,
  setSubscription,
} from "../../../application/services/store-network/store-registry.ts";
import {
  fetchRemoteRepositories,
  RemoteStoreError,
  searchRemoteRepositories,
} from "../../../application/services/store-network/remote-store-client.ts";
import { importRepositoryFromRemoteStore } from "../../../application/services/store-network/remote-install.ts";
import {
  getStoreUpdates,
  markAllUpdatesSeen,
  markUpdatesSeen,
  pollSingleStore,
} from "../../../application/services/store-network/store-subscription.ts";

export const storeRegistryRouteDeps = {
  requireSpaceAccess,
  addRemoteStore,
  getRegistryEntry,
  listRegisteredStores,
  refreshRemoteStore,
  removeRemoteStore,
  setActiveStore,
  setSubscription,
  fetchRemoteRepositories,
  searchRemoteRepositories,
  importRepositoryFromRemoteStore,
  getStoreUpdates,
  markAllUpdatesSeen,
  markUpdatesSeen,
  pollSingleStore,
};

export function safeErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof RemoteStoreError) return error.message;
  return fallback;
}

export function parseRoutePage(raw: string | null | undefined): number {
  const page = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export function formatEntry(entry: {
  id: string;
  actorUrl: string;
  domain: string;
  storeSlug: string;
  name: string;
  summary: string | null;
  iconUrl: string | null;
  isActive: boolean;
  subscriptionEnabled: boolean;
  lastFetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    id: entry.id,
    store_url: entry.actorUrl,
    domain: entry.domain,
    store_slug: entry.storeSlug,
    name: entry.name,
    summary: entry.summary,
    icon_url: entry.iconUrl,
    is_active: entry.isActive,
    subscription_enabled: entry.subscriptionEnabled,
    last_fetched_at: entry.lastFetchedAt,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
  };
}

export function formatRepository(repo: {
  id: string;
  name?: string | null;
  summary?: string | null;
  repositoryUrl?: string | null;
  url?: string | null;
  owner?: string | null;
  defaultBranch?: string | null;
  defaultBranchHash?: string | null;
  cloneUrl?: string | null;
  browseUrl?: string | null;
  published?: string | null;
  updated?: string | null;
}) {
  return {
    id: repo.id,
    name: repo.name,
    summary: repo.summary,
    repository_url: repo.repositoryUrl || repo.url,
    url: repo.url,
    owner: repo.owner,
    default_branch: repo.defaultBranch,
    default_branch_hash: repo.defaultBranchHash,
    clone_url: repo.cloneUrl,
    browse_url: repo.browseUrl,
    published: repo.published,
    updated: repo.updated,
  };
}

export function formatStoreUpdate(update: {
  id: string;
  registryEntryId: string;
  storeName: string;
  storeDomain: string;
  activityId: string;
  activityType: string;
  objectId: string | null;
  objectType: string | null;
  objectName: string | null;
  objectSummary: string | null;
  published: string | null;
  seen: boolean;
  createdAt: string;
}) {
  return {
    id: update.id,
    registry_entry_id: update.registryEntryId,
    store_name: update.storeName,
    store_domain: update.storeDomain,
    activity_id: update.activityId,
    activity_type: update.activityType,
    object_id: update.objectId,
    object_type: update.objectType,
    object_name: update.objectName,
    object_summary: update.objectSummary,
    published: update.published,
    seen: update.seen,
    created_at: update.createdAt,
  };
}

export async function requireStoreRegistryEntry(
  db: D1Database,
  spaceId: string,
  entryId: string,
) {
  const entry = await storeRegistryRouteDeps.getRegistryEntry(
    db,
    spaceId,
    entryId,
  );
  if (!entry) {
    throw new NotFoundError("Store registry entry");
  }
  return entry;
}
