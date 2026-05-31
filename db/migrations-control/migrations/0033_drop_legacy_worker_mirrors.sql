DROP TRIGGER IF EXISTS "trg_services_mirror_insert_to_workers";
DROP TRIGGER IF EXISTS "trg_services_mirror_update_to_workers";
DROP TRIGGER IF EXISTS "trg_services_mirror_delete_to_workers";

DROP TABLE IF EXISTS "worker_bindings";
DROP TABLE IF EXISTS "worker_common_env_links";
DROP TABLE IF EXISTS "workers";
