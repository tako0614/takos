import type { D1Database } from "../../../shared/types/bindings.ts";
import { and, desc, eq } from "drizzle-orm";
import { getDb, skills as skillsTable } from "../../../infra/db/index.ts";
import { generateId } from "../../../shared/utils/index.ts";
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
  db: D1Database,
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
  db: D1Database,
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

export async function listSkills(db: D1Database, spaceId: string) {
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
  db: D1Database,
  spaceId: string,
  skillId: string,
): Promise<SkillRow | null> {
  const skill = await fetchSkillRecordById(db, spaceId, skillId);
  return skill ? toSkillRow(skill) : null;
}

export async function getSkillByName(
  db: D1Database,
  spaceId: string,
  name: string,
): Promise<SkillRow | null> {
  const skill = await fetchSkillRecordByName(db, spaceId, name);
  return skill ? toSkillRow(skill) : null;
}

export async function createSkill(
  db: D1Database,
  spaceId: string,
  input: {
    name: string;
    description?: string;
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
  db: D1Database,
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
    .where(eq(skillsTable.id, skillId))
    .returning()
    .get();

  return toSkillRow(updated);
}

export async function updateSkillByName(
  db: D1Database,
  spaceId: string,
  skillName: string,
  input: SkillMutationInput,
): Promise<SkillRow | null> {
  const skill = await getSkillByName(db, spaceId, skillName);
  if (!skill) return null;
  return updateSkill(db, spaceId, skill.id, input);
}

export async function updateSkillEnabled(
  db: D1Database,
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
    .where(eq(skillsTable.id, skillId));

  return enabled;
}

export async function updateSkillEnabledByName(
  db: D1Database,
  spaceId: string,
  skillName: string,
  enabled: boolean,
): Promise<boolean> {
  const skill = await getSkillByName(db, spaceId, skillName);
  if (!skill) throw new Error("Skill not found");
  return updateSkillEnabled(db, skill.id, enabled);
}

export async function deleteSkill(
  db: D1Database,
  skillId: string,
): Promise<void> {
  const drizzle = getDb(db);
  await drizzle.delete(skillsTable).where(eq(skillsTable.id, skillId));
}

export async function deleteSkillByName(
  db: D1Database,
  spaceId: string,
  skillName: string,
): Promise<void> {
  const skill = await getSkillByName(db, spaceId, skillName);
  if (!skill) throw new Error("Skill not found");
  await deleteSkill(db, skill.id);
}

export async function listEnabledCustomSkillContext(
  db: D1Database,
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
