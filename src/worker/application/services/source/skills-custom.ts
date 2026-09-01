import type { SqlDatabaseBinding } from "../../../shared/types/bindings.ts";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  agentResourceDeletionOutbox,
  agentResourceTombstones,
  getDb,
  skills as skillsTable,
} from "../../../infra/db/index.ts";
import { generateId } from "../../../shared/utils/index.ts";
import { prepareAgentResourceDeletion } from "../agent/resource-deletion.ts";
import {
  customSkillResourceId,
  skillRevisionSnapshot,
} from "../agent/skill-revisions.ts";
import {
  type CustomSkillMetadata,
  formatSkill,
  parseSkillMetadata,
  serializeSkillMetadata,
  type SkillMutationInput,
  type SkillRow,
  toCustomSkillContext,
  toSkillRow,
  validateSkillMetadataForWorkspace,
} from "./skills-shared.ts";

async function fetchSkillRecordById(
  db: SqlDatabaseBinding,
  spaceId: string,
  skillId: string,
) {
  const drizzle = getDb(db);
  return await drizzle
    .select()
    .from(skillsTable)
    .where(and(eq(skillsTable.id, skillId), eq(skillsTable.accountId, spaceId)))
    .get();
}

async function fetchSkillRecordByName(
  db: SqlDatabaseBinding,
  spaceId: string,
  name: string,
) {
  const drizzle = getDb(db);
  return await drizzle
    .select()
    .from(skillsTable)
    .where(and(eq(skillsTable.accountId, spaceId), eq(skillsTable.name, name)))
    .get();
}

function buildSkillUpdatePayload(
  skill: SkillRow,
  metadata: CustomSkillMetadata,
  input: SkillMutationInput,
) {
  return {
    name: input.name?.trim() || skill.name,
    description: input.description !== undefined
      ? (input.description?.trim() || null)
      : skill.description,
    instructions: input.instructions?.trim() || skill.instructions,
    triggers: input.triggers !== undefined
      ? (input.triggers.join(",") || null)
      : skill.triggers,
    metadata: serializeSkillMetadata(metadata),
    enabled: input.enabled !== undefined ? input.enabled : skill.enabled,
    updatedAt: new Date().toISOString(),
  };
}

export async function listSkills(db: SqlDatabaseBinding, spaceId: string) {
  const drizzle = getDb(db);
  const rows = await drizzle
    .select()
    .from(skillsTable)
    .where(eq(skillsTable.accountId, spaceId))
    .orderBy(desc(skillsTable.updatedAt), desc(skillsTable.createdAt))
    .all();

  return rows.map((skill) => formatSkill(toSkillRow(skill)));
}

export async function getSkill(
  db: SqlDatabaseBinding,
  spaceId: string,
  skillId: string,
): Promise<SkillRow | null> {
  const skill = await fetchSkillRecordById(db, spaceId, skillId);
  return skill ? toSkillRow(skill) : null;
}

export async function getSkillByName(
  db: SqlDatabaseBinding,
  spaceId: string,
  name: string,
): Promise<SkillRow | null> {
  const skill = await fetchSkillRecordByName(db, spaceId, name);
  return skill ? toSkillRow(skill) : null;
}

export async function createSkill(
  db: SqlDatabaseBinding,
  spaceId: string,
  input: {
    name: string;
    description?: string | null;
    instructions: string;
    triggers?: string[];
    metadata?: unknown;
  },
): Promise<SkillRow | null> {
  const drizzle = getDb(db);
  const metadata = await validateSkillMetadataForWorkspace(
    db,
    spaceId,
    input.metadata,
  );
  const skill = await drizzle
    .insert(skillsTable)
    .values({
      id: generateId(),
      accountId: spaceId,
      name: input.name.trim(),
      description: input.description?.trim() || null,
      instructions: input.instructions.trim(),
      triggers: input.triggers?.join(",") || null,
      metadata: serializeSkillMetadata(metadata),
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .returning()
    .get();

  return toSkillRow(skill);
}

export async function updateSkill(
  db: SqlDatabaseBinding,
  spaceId: string,
  skillId: string,
  input: SkillMutationInput,
): Promise<SkillRow | null> {
  const drizzle = getDb(db);
  const skill = await getSkill(db, spaceId, skillId);
  if (!skill) return null;

  const metadata = input.metadata !== undefined
    ? await validateSkillMetadataForWorkspace(db, spaceId, input.metadata)
    : parseSkillMetadata(skill.metadata);

  const updated = await drizzle
    .update(skillsTable)
    .set(buildSkillUpdatePayload(skill, metadata, input))
    .where(
      and(eq(skillsTable.id, skillId), eq(skillsTable.accountId, spaceId)),
    )
    .returning()
    .get();

  return toSkillRow(updated);
}

export async function updateSkillByName(
  db: SqlDatabaseBinding,
  spaceId: string,
  skillName: string,
  input: SkillMutationInput,
): Promise<SkillRow | null> {
  const skill = await getSkillByName(db, spaceId, skillName);
  if (!skill) return null;
  return updateSkill(db, spaceId, skill.id, input);
}

export async function updateSkillEnabled(
  db: SqlDatabaseBinding,
  spaceId: string,
  skillId: string,
  enabled: boolean,
): Promise<boolean> {
  const drizzle = getDb(db);
  await drizzle
    .update(skillsTable)
    .set({
      enabled,
      updatedAt: new Date().toISOString(),
    })
    .where(
      and(eq(skillsTable.id, skillId), eq(skillsTable.accountId, spaceId)),
    );

  return enabled;
}

export async function updateSkillEnabledByName(
  db: SqlDatabaseBinding,
  spaceId: string,
  skillName: string,
  enabled: boolean,
): Promise<boolean> {
  const skill = await getSkillByName(db, spaceId, skillName);
  if (!skill) throw new Error("Skill not found");
  return updateSkillEnabled(db, spaceId, skill.id, enabled);
}

export async function deleteSkill(
  db: SqlDatabaseBinding,
  spaceId: string,
  skillId: string,
  deletedByAccountId: string,
): Promise<{ tombstoneId: string } | null> {
  const drizzle = getDb(db);
  const skill = await getSkill(db, spaceId, skillId);
  const resourceId = await customSkillResourceId(skillId);
  if (!skill) {
    const tombstone = await drizzle.select({
      id: agentResourceTombstones.id,
    }).from(agentResourceTombstones).where(and(
      eq(agentResourceTombstones.accountId, spaceId),
      eq(agentResourceTombstones.resourceKind, "skill_revision"),
      eq(agentResourceTombstones.resourceId, resourceId),
    )).get();
    return tombstone ? { tombstoneId: tombstone.id } : null;
  }

  const deletedAt = new Date().toISOString();
  const source = await skillRevisionSnapshot(
    spaceId,
    toCustomSkillContext(skill),
  );
  const deletion = await prepareAgentResourceDeletion({
    accountId: spaceId,
    resourceKind: "skill_revision",
    resourceId,
    source,
    deletedByAccountId,
    deletedAt,
  });
  const exactSource = and(
    eq(skillsTable.id, skillId),
    eq(skillsTable.accountId, spaceId),
    eq(skillsTable.updatedAt, skill.updatedAt),
  );
  const tombstoneInsert = drizzle.insert(agentResourceTombstones).select(
    drizzle.select({
      id: sql<string>`${deletion.id}`.as("id"),
      accountId: skillsTable.accountId,
      resourceKind: sql<string>`${deletion.resourceKind}`.as("resource_kind"),
      resourceId: sql<string>`${resourceId}`.as("resource_id"),
      sourceDigest: sql<string>`${deletion.sourceDigest}`.as("source_digest"),
      deletedByAccountId: sql<string>`${deletion.deletedByAccountId}`.as(
        "deleted_by_account_id",
      ),
      deletedAt: sql<string>`${deletedAt}`.as("deleted_at"),
      createdAt: sql<string>`${deletedAt}`.as("created_at"),
    }).from(skillsTable).where(exactSource),
  ).onConflictDoNothing();
  const outboxInsert = drizzle.insert(agentResourceDeletionOutbox).select(
    drizzle.select({
      id: agentResourceTombstones.id,
      accountId: agentResourceTombstones.accountId,
      resourceKind: agentResourceTombstones.resourceKind,
      resourceId: agentResourceTombstones.resourceId,
      vectorIds: sql<string>`${deletion.vectorIdsJson}`.as("vector_ids"),
      offloadObjectKeys: sql<string>`${deletion.offloadObjectKeysJson}`.as(
        "offload_object_keys",
      ),
      deliveryStatus: sql<string>`'pending'`.as("delivery_status"),
      attempts: sql<number>`0`.as("attempts"),
      claimToken: sql<string | null>`NULL`.as("claim_token"),
      claimedAt: sql<string | null>`NULL`.as("claimed_at"),
      nextAttemptAt: sql<string | null>`NULL`.as("next_attempt_at"),
      completedAt: sql<string | null>`NULL`.as("completed_at"),
      lastError: sql<string | null>`NULL`.as("last_error"),
      createdAt: agentResourceTombstones.createdAt,
      updatedAt: agentResourceTombstones.createdAt,
    }).from(agentResourceTombstones).where(
      eq(agentResourceTombstones.id, deletion.id),
    ),
  ).onConflictDoNothing();
  await drizzle.batch([
    tombstoneInsert,
    outboxInsert,
    drizzle.delete(skillsTable).where(exactSource),
  ]);

  const [remaining, tombstone] = await Promise.all([
    getSkill(db, spaceId, skillId),
    drizzle.select({ id: agentResourceTombstones.id })
      .from(agentResourceTombstones)
      .where(and(
        eq(agentResourceTombstones.id, deletion.id),
        eq(agentResourceTombstones.accountId, spaceId),
        eq(agentResourceTombstones.resourceKind, "skill_revision"),
        eq(agentResourceTombstones.resourceId, resourceId),
      )).get(),
  ]);
  if (remaining || !tombstone) return null;
  return { tombstoneId: tombstone.id };
}

export async function deleteSkillByName(
  db: SqlDatabaseBinding,
  spaceId: string,
  skillName: string,
  deletedByAccountId: string,
): Promise<{ tombstoneId: string } | null> {
  const skill = await getSkillByName(db, spaceId, skillName);
  if (!skill) throw new Error("Skill not found");
  return await deleteSkill(db, spaceId, skill.id, deletedByAccountId);
}

export async function listEnabledCustomSkillContext(
  db: SqlDatabaseBinding,
  spaceId: string,
) {
  const drizzle = getDb(db);
  const rows = await drizzle
    .select()
    .from(skillsTable)
    .where(
      and(eq(skillsTable.accountId, spaceId), eq(skillsTable.enabled, true)),
    )
    .orderBy(desc(skillsTable.updatedAt), desc(skillsTable.createdAt))
    .all();

  return rows.map((skill) => toCustomSkillContext(toSkillRow(skill)));
}
