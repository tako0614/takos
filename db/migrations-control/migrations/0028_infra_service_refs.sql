ALTER TABLE "infra_endpoints" RENAME COLUMN "target_worker_name" TO "target_service_ref";
ALTER TABLE "infra_workers" RENAME COLUMN "cf_worker_name" TO "cloudflare_service_ref";
