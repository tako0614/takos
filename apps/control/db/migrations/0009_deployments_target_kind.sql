ALTER TABLE "deployments" ADD COLUMN "target_kind" TEXT NOT NULL DEFAULT 'cloudflare';
ALTER TABLE "deployments" ADD COLUMN "target_config_json" TEXT NOT NULL DEFAULT '{}';
