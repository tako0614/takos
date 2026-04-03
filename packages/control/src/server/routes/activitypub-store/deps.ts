import {
  findCanonicalRepo,
  findCanonicalRepoIncludingPrivate,
  findStoreBySlug,
  listStoreRepositories,
  listStoresForRepo,
  searchStoreRepositories,
} from "./activitypub-queries.ts";
import {
  listPushActivities,
  listPushActivitiesForRepoIds,
} from "../../../application/services/activitypub/push-activities.ts";
import {
  hasExplicitInventory,
  listInventoryActivities,
  listInventoryItems,
} from "../../../application/services/activitypub/store-inventory.ts";
import {
  addFollower,
  listFollowers,
  removeFollower,
} from "../../../application/services/activitypub/followers.ts";
import { checkGrant } from "../../../application/services/activitypub/grants.ts";
import { verifyHttpSignature } from "../../middleware/http-signature.ts";

export interface ActivityPubStoreDeps {
  findCanonicalRepo: typeof findCanonicalRepo;
  findCanonicalRepoIncludingPrivate: typeof findCanonicalRepoIncludingPrivate;
  findStoreBySlug: typeof findStoreBySlug;
  listStoreRepositories: typeof listStoreRepositories;
  listStoresForRepo: typeof listStoresForRepo;
  searchStoreRepositories: typeof searchStoreRepositories;
  listPushActivities: typeof listPushActivities;
  listPushActivitiesForRepoIds: typeof listPushActivitiesForRepoIds;
  hasExplicitInventory: typeof hasExplicitInventory;
  listInventoryActivities: typeof listInventoryActivities;
  listInventoryItems: typeof listInventoryItems;
  addFollower: typeof addFollower;
  removeFollower: typeof removeFollower;
  listFollowers: typeof listFollowers;
  checkGrant: typeof checkGrant;
  verifyHttpSignature: typeof verifyHttpSignature;
}

export const activitypubStoreDeps: ActivityPubStoreDeps = {
  findCanonicalRepo,
  findCanonicalRepoIncludingPrivate,
  findStoreBySlug,
  listStoreRepositories,
  listStoresForRepo,
  searchStoreRepositories,
  listPushActivities,
  listPushActivitiesForRepoIds,
  hasExplicitInventory,
  listInventoryActivities,
  listInventoryItems,
  addFollower,
  removeFollower,
  listFollowers,
  checkGrant,
  verifyHttpSignature,
};

export function setActivitypubStoreTestDeps(
  overrides: Partial<ActivityPubStoreDeps>,
): void {
  Object.assign(activitypubStoreDeps, overrides);
}
