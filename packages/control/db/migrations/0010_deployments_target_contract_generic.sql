ALTER TABLE "deployments" RENAME COLUMN "target_kind" TO "provider_name";
ALTER TABLE "deployments" RENAME COLUMN "target_config_json" TO "target_json";
ALTER TABLE "deployments" ADD COLUMN "provider_state_json" TEXT NOT NULL DEFAULT '{}';
