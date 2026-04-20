PRAGMA foreign_keys=OFF;

ALTER TABLE "deployments" RENAME TO "deployments__old_service_id_cutover";

CREATE TABLE "deployments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "service_id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "artifact_ref" TEXT,
    "bundle_r2_key" TEXT,
    "bundle_hash" TEXT,
    "bundle_size" INTEGER,
    "wasm_r2_key" TEXT,
    "wasm_hash" TEXT,
    "assets_manifest" TEXT,
    "runtime_config_snapshot_json" TEXT NOT NULL DEFAULT '{}',
    "bindings_snapshot_encrypted" TEXT,
    "env_vars_snapshot_encrypted" TEXT,
    "deploy_state" TEXT NOT NULL DEFAULT 'pending',
    "current_step" TEXT,
    "step_error" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "routing_status" TEXT NOT NULL DEFAULT 'archived',
    "routing_weight" INTEGER NOT NULL DEFAULT 0,
    "deployed_by" TEXT,
    "deploy_message" TEXT,
    "backend_name" TEXT NOT NULL DEFAULT 'cloudflare',
    "target_json" TEXT NOT NULL DEFAULT '{}',
    "backend_state_json" TEXT NOT NULL DEFAULT '{}',
    "idempotency_key" TEXT,
    "is_rollback" INTEGER NOT NULL DEFAULT 0,
    "rollback_from_version" INTEGER,
    "rolled_back_at" DATETIME,
    "rolled_back_by" TEXT,
    "started_at" DATETIME,
    "completed_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deployments_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "deployments_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "services" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "deployments" (
    "id",
    "service_id",
    "account_id",
    "version",
    "artifact_ref",
    "bundle_r2_key",
    "bundle_hash",
    "bundle_size",
    "wasm_r2_key",
    "wasm_hash",
    "assets_manifest",
    "runtime_config_snapshot_json",
    "bindings_snapshot_encrypted",
    "env_vars_snapshot_encrypted",
    "deploy_state",
    "current_step",
    "step_error",
    "status",
    "routing_status",
    "routing_weight",
    "deployed_by",
    "deploy_message",
    "backend_name",
    "target_json",
    "backend_state_json",
    "idempotency_key",
    "is_rollback",
    "rollback_from_version",
    "rolled_back_at",
    "rolled_back_by",
    "started_at",
    "completed_at",
    "created_at",
    "updated_at"
)
SELECT
    "id",
    "worker_id",
    "account_id",
    "version",
    "artifact_ref",
    "bundle_r2_key",
    "bundle_hash",
    "bundle_size",
    "wasm_r2_key",
    "wasm_hash",
    "assets_manifest",
    "runtime_config_snapshot_json",
    "bindings_snapshot_encrypted",
    "env_vars_snapshot_encrypted",
    "deploy_state",
    "current_step",
    "step_error",
    "status",
    "routing_status",
    "routing_weight",
    "deployed_by",
    "deploy_message",
    COALESCE("backend_name", 'cloudflare'),
    COALESCE("target_json", '{}'),
    COALESCE("backend_state_json", '{}'),
    "idempotency_key",
    COALESCE("is_rollback", 0),
    "rollback_from_version",
    "rolled_back_at",
    "rolled_back_by",
    "started_at",
    "completed_at",
    "created_at",
    "updated_at"
FROM "deployments__old_service_id_cutover";

DROP TABLE "deployments__old_service_id_cutover";

CREATE UNIQUE INDEX "idx_deployments_worker_version" ON "deployments"("service_id", "version");
CREATE INDEX "idx_deployments_worker_routing_status" ON "deployments"("service_id", "routing_status");
CREATE INDEX "idx_deployments_worker_id" ON "deployments"("service_id");
CREATE INDEX "idx_deployments_worker_created_at" ON "deployments"("service_id", "created_at");
CREATE INDEX "idx_deployments_status" ON "deployments"("status");
CREATE INDEX "idx_deployments_account_status" ON "deployments"("account_id", "status");
CREATE INDEX "idx_deployments_account_id" ON "deployments"("account_id");
CREATE UNIQUE INDEX "deployments_idempotency_key_key" ON "deployments"("idempotency_key");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
