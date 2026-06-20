-- takos-migration-safety: contract
-- takos-migration-approval: Takos Workspaces are not mirrored as synchronous Takosumi Installations. Takos projects Takosumi Installation / OutputSnapshot state for apps instead of storing a workspace-level dual-write id on accounts.
-- takos-migration-rollback: add a forward compatibility column only if rolling back to a version that writes the retired workspace dual-write integration.

ALTER TABLE "accounts" DROP COLUMN "takosumi_installation_id";
