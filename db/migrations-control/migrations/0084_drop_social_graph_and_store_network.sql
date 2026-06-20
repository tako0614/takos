-- takos-migration-safety: contract
-- takos-migration-approval: Takos is a single-owner personal product. The in-app social graph (account follows / follow requests / blocks / mutes / repo stars) and the entire Store Network + federation surface (repo push activity feed, store inventory/registry, ActivityPub followers + delivery queue) are removed. No remaining reader or writer references these tables: the profiles routes, store-network services, public-store routes, and space store/store-registry routes were deleted, and getStarredRepoIds now returns an empty set.
-- takos-migration-rollback: restore the dropped tables from backup, then add a forward compatibility migration before rolling application code back to a version that mounts the social graph, Store Network, or federation surfaces.

-- Social graph (in-app follow/block/mute + repo stars)
DROP INDEX IF EXISTS idx_repo_stars_repo_id;
DROP INDEX IF EXISTS idx_repo_stars_account_id;
DROP TABLE IF EXISTS repo_stars;

DROP INDEX IF EXISTS idx_account_follows_following_account_id;
DROP INDEX IF EXISTS idx_account_follows_follower_account_id;
DROP TABLE IF EXISTS account_follows;

DROP INDEX IF EXISTS idx_account_follow_requests_requester_target;
DROP INDEX IF EXISTS idx_account_follow_requests_target_status;
DROP INDEX IF EXISTS idx_account_follow_requests_requester;
DROP INDEX IF EXISTS idx_account_follow_requests_created_at;
DROP TABLE IF EXISTS account_follow_requests;

DROP INDEX IF EXISTS idx_account_blocks_blocker_account_id;
DROP INDEX IF EXISTS idx_account_blocks_blocked_account_id;
DROP TABLE IF EXISTS account_blocks;

DROP INDEX IF EXISTS idx_account_mutes_muter_account_id;
DROP INDEX IF EXISTS idx_account_mutes_muted_account_id;
DROP TABLE IF EXISTS account_mutes;

-- Store Network feed + inventory + registry
DROP INDEX IF EXISTS idx_push_activities_repo;
DROP INDEX IF EXISTS idx_push_activities_account;
DROP INDEX IF EXISTS idx_push_activities_account_created;
DROP INDEX IF EXISTS idx_push_activities_created;
DROP TABLE IF EXISTS repo_push_activities;

DROP INDEX IF EXISTS idx_store_inventory_store;
DROP INDEX IF EXISTS idx_store_inventory_active;
DROP INDEX IF EXISTS idx_store_inventory_created;
DROP INDEX IF EXISTS idx_store_inventory_local_repo;
DROP INDEX IF EXISTS idx_store_inventory_unique_active;
DROP TABLE IF EXISTS store_inventory_items;

DROP INDEX IF EXISTS idx_store_registry_account_id;
DROP INDEX IF EXISTS idx_store_registry_account_actor;
DROP INDEX IF EXISTS idx_store_registry_domain;
DROP INDEX IF EXISTS idx_store_registry_subscription;
DROP TABLE IF EXISTS store_registry;

DROP INDEX IF EXISTS idx_store_registry_updates_registry;
DROP INDEX IF EXISTS idx_store_registry_updates_account;
DROP INDEX IF EXISTS idx_store_registry_updates_activity;
DROP INDEX IF EXISTS idx_store_registry_updates_seen;
DROP TABLE IF EXISTS store_registry_updates;

-- Federation (ActivityPub)
DROP INDEX IF EXISTS idx_ap_followers_target;
DROP INDEX IF EXISTS idx_ap_followers_unique;
DROP TABLE IF EXISTS ap_followers;

DROP INDEX IF EXISTS idx_ap_delivery_queue_status_next;
DROP INDEX IF EXISTS idx_ap_delivery_queue_activity_id;
DROP TABLE IF EXISTS ap_delivery_queue;
