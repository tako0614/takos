/**
 * Capability Grants Service — manages visit/read/write/admin grants for repo access.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { D1Database } from "../../../shared/types/bindings.ts";
import { getDb, repoGrants } from "../../../infra/db/index.ts";
import { generateId } from "../../../shared/utils/index.ts";

export type Capability = "visit" | "read" | "write" | "admin";

const CAPABILITY_HIERARCHY: Record<Capability, Capability[]> = {
  visit: ["visit", "read", "write", "admin"],
  read: ["read", "write", "admin"],
  write: ["write", "admin"],
  admin: ["admin"],
};

export function grantCapabilitiesFor(capability: Capability): Capability[] {
  return CAPABILITY_HIERARCHY[capability];
}

export interface GrantRecord {
  id: string;
  repoId: string;
  granteeActorUrl: string;
  capability: Capability;
  grantedBy: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreateGrantInput {
  repoId: string;
  granteeActorUrl: string;
  capability: Capability;
  grantedBy?: string;
  expiresAt?: string;
}

export async function createGrant(
  dbBinding: D1Database,
  input: CreateGrantInput,
): Promise<GrantRecord> {
  const db = getDb(dbBinding);
  const id = generateId();
  const timestamp = new Date().toISOString();

  const record = {
    id,
    repoId: input.repoId,
    granteeActorUrl: input.granteeActorUrl,
    capability: input.capability,
    grantedBy: input.grantedBy || null,
    expiresAt: input.expiresAt || null,
    createdAt: timestamp,
  };

  await db.insert(repoGrants).values(record);
  return record;
}

export async function listGrants(
  dbBinding: D1Database,
  repoId: string,
): Promise<GrantRecord[]> {
  const db = getDb(dbBinding);
  const rows = await db.select().from(repoGrants)
    .where(eq(repoGrants.repoId, repoId))
    .all();

  return rows.map(toRecord);
}

export async function checkGrant(
  dbBinding: D1Database,
  repoId: string,
  granteeActorUrl: string,
  capability: Capability,
): Promise<boolean> {
  const db = getDb(dbBinding);
  const now = new Date().toISOString();

  const rows = await db.select({
    id: repoGrants.id,
    expiresAt: repoGrants.expiresAt,
  }).from(repoGrants)
    .where(and(
      eq(repoGrants.repoId, repoId),
      eq(repoGrants.granteeActorUrl, granteeActorUrl),
      inArray(repoGrants.capability, grantCapabilitiesFor(capability)),
    ))
    .all();

  for (const row of rows) {
    if (row.expiresAt && row.expiresAt < now) {
      await db.delete(repoGrants).where(eq(repoGrants.id, row.id));
      continue;
    }
    return true;
  }

  return false;
}

export async function revokeGrant(
  dbBinding: D1Database,
  grantId: string,
): Promise<void> {
  const db = getDb(dbBinding);
  await db.delete(repoGrants).where(eq(repoGrants.id, grantId));
}

export async function revokeAllGrants(
  dbBinding: D1Database,
  repoId: string,
  granteeActorUrl: string,
): Promise<void> {
  const db = getDb(dbBinding);
  await db.delete(repoGrants).where(and(
    eq(repoGrants.repoId, repoId),
    eq(repoGrants.granteeActorUrl, granteeActorUrl),
  ));
}

function toRecord(row: typeof repoGrants.$inferSelect): GrantRecord {
  return {
    id: row.id,
    repoId: row.repoId,
    granteeActorUrl: row.granteeActorUrl,
    capability: row.capability as Capability,
    grantedBy: row.grantedBy,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}
