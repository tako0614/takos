PRAGMA foreign_keys=OFF;

ALTER TABLE "deployment_events" RENAME TO "deployment_events__old_deployments_fk_repair";

CREATE TABLE "deployment_events" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "deployment_id" TEXT NOT NULL,
    "actor_account_id" TEXT,
    "event_type" TEXT NOT NULL,
    "step_name" TEXT,
    "message" TEXT,
    "details" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "deployment_events_actor_account_id_fkey" FOREIGN KEY ("actor_account_id") REFERENCES "accounts" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "deployment_events_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "deployments" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

INSERT INTO "deployment_events" (
    "id",
    "deployment_id",
    "actor_account_id",
    "event_type",
    "step_name",
    "message",
    "details",
    "created_at"
)
SELECT
    "id",
    "deployment_id",
    "actor_account_id",
    "event_type",
    "step_name",
    "message",
    "details",
    "created_at"
FROM "deployment_events__old_deployments_fk_repair";

DROP TABLE "deployment_events__old_deployments_fk_repair";

CREATE INDEX "deployment_events_event_type_idx" ON "deployment_events"("event_type");
CREATE INDEX "deployment_events_deployment_id_idx" ON "deployment_events"("deployment_id");
CREATE INDEX "deployment_events_actor_account_id_idx" ON "deployment_events"("actor_account_id");

PRAGMA foreign_key_check;
PRAGMA foreign_keys=ON;
