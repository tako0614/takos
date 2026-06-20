import {
  index,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { createdAtColumn } from "./schema-utils.ts";

/**
 * Index naming note.
 *
 * The applied baseline SQL and the Drizzle declarations do not always use the
 * same naming convention for equivalent indexes. Treat generated
 * index-name-only diffs as intentional schema-change candidates: either apply
 * the rename consistently to every environment or keep the generated migration
 * a no-op. New table declarations should choose explicit `.index()` names that
 * match their applied SQL so the drift set does not grow.
 */

// 119. RepoGrants — capability grants for repo access (visit/read/write/admin)
export const repoGrants = sqliteTable("repo_grants", {
  id: text("id").primaryKey(),
  repoId: text("repo_id").notNull(),
  granteeActorUrl: text("grantee_actor_url").notNull(),
  capability: text("capability").notNull(),
  grantedBy: text("granted_by"),
  expiresAt: text("expires_at"),
  ...createdAtColumn,
}, (table) => ({
  idxRepo: index("idx_repo_grants_repo").on(table.repoId),
  uniqGrant: uniqueIndex("idx_repo_grants_unique").on(
    table.repoId,
    table.granteeActorUrl,
    table.capability,
  ),
}));
