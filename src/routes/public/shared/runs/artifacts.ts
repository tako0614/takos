import type {
  Artifact,
  ArtifactType,
  SqlDatabaseBinding,
} from "takos-api-contract/shared/types";
import { generateId } from "@takos/worker-platform-utils/id";
import { readSpaceMembershipRole } from "../spaces/access.ts";
import { readRunAccess } from "./read-model.ts";

type ArtifactRow = {
  id: string;
  runId: string;
  accountId: string;
  type: string;
  title: string | null;
  content: string | null;
  fileId: string | null;
  metadata: string;
  createdAt: string | Date;
};

export type CreateRunArtifactInput = {
  type: ArtifactType;
  title?: string;
  content?: string;
  file_id?: string;
  metadata?: Record<string, unknown>;
};

const VALID_ARTIFACT_TYPES: ReadonlySet<ArtifactType> = new Set<ArtifactType>([
  "code",
  "config",
  "doc",
  "patch",
  "report",
  "other",
]);

export function isArtifactType(value: string): value is ArtifactType {
  return VALID_ARTIFACT_TYPES.has(value as ArtifactType);
}

export async function listRunArtifacts(
  db: SqlDatabaseBinding,
  runId: string,
  actorAccountId: string,
): Promise<Artifact[] | null> {
  const access = await readRunAccess(db, runId, actorAccountId);
  if (!access) return null;

  const rows = await db.prepare(`
    SELECT
      id,
      run_id AS runId,
      account_id AS accountId,
      type,
      title,
      content,
      file_id AS fileId,
      metadata,
      created_at AS createdAt
    FROM artifacts
    WHERE run_id = ?
    ORDER BY created_at ASC
  `).bind(runId).all<Record<string, unknown>>();

  return rows.results.map((row) => artifactRowToApi(asArtifactRow(row)));
}

export async function createRunArtifact(
  db: SqlDatabaseBinding,
  runId: string,
  actorAccountId: string,
  input: CreateRunArtifactInput,
): Promise<Artifact | null> {
  const access = await readRunAccess(db, runId, actorAccountId, [
    "owner",
    "admin",
    "editor",
  ]);
  if (!access) return null;

  const row = await db.prepare(`
    INSERT INTO artifacts (
      id,
      run_id,
      account_id,
      type,
      title,
      content,
      file_id,
      metadata,
      created_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING
      id,
      run_id AS runId,
      account_id AS accountId,
      type,
      title,
      content,
      file_id AS fileId,
      metadata,
      created_at AS createdAt
  `).bind(
    generateId(),
    runId,
    access.run.space_id,
    input.type,
    input.title ?? null,
    input.content ?? null,
    input.file_id ?? null,
    JSON.stringify(input.metadata ?? {}),
    new Date().toISOString(),
  ).first<Record<string, unknown>>();

  if (!row) {
    throw new Error(
      `artifact insert did not return a row (runId=${runId}, type=${input.type}, space=${access.run.space_id})`,
    );
  }

  return artifactRowToApi(asArtifactRow(row));
}

export async function readArtifactAccess(
  db: SqlDatabaseBinding,
  artifactId: string,
  actorAccountId: string,
): Promise<Artifact | null> {
  const row = await db.prepare(`
    SELECT
      id,
      run_id AS runId,
      account_id AS accountId,
      type,
      title,
      content,
      file_id AS fileId,
      metadata,
      created_at AS createdAt
    FROM artifacts
    WHERE id = ?
    LIMIT 1
  `).bind(artifactId).first<Record<string, unknown>>();
  if (!row) return null;

  const artifact = artifactRowToApi(asArtifactRow(row));
  const role = await readSpaceMembershipRole(
    db,
    artifact.space_id,
    actorAccountId,
  );
  if (!role) return null;

  return artifact;
}

function artifactRowToApi(row: ArtifactRow): Artifact {
  return {
    id: row.id,
    run_id: row.runId,
    space_id: row.accountId,
    type: row.type as ArtifactType,
    title: row.title,
    content: row.content,
    file_id: row.fileId,
    metadata: row.metadata,
    created_at: toIsoString(row.createdAt),
  };
}

function asArtifactRow(row: Record<string, unknown>): ArtifactRow {
  return {
    id: stringField(row, "id"),
    runId: stringField(row, "runId"),
    accountId: stringField(row, "accountId"),
    type: stringField(row, "type"),
    title: nullableStringField(row, "title"),
    content: nullableStringField(row, "content"),
    fileId: nullableStringField(row, "fileId"),
    metadata: stringField(row, "metadata"),
    createdAt: dateField(row, "createdAt"),
  };
}

function stringField(
  row: Record<string, unknown>,
  key: keyof ArtifactRow,
): string {
  const value = row[key];
  if (typeof value === "string") return value;
  throw new TypeError(`Artifact row field ${String(key)} must be a string`);
}

function nullableStringField(
  row: Record<string, unknown>,
  key: keyof ArtifactRow,
): string | null {
  const value = row[key];
  if (value == null) return null;
  if (typeof value === "string") return value;
  throw new TypeError(
    `Artifact row field ${String(key)} must be a string or null`,
  );
}

function dateField(
  row: Record<string, unknown>,
  key: keyof ArtifactRow,
): string | Date {
  const value = row[key];
  if (typeof value === "string" || value instanceof Date) return value;
  throw new TypeError(`Artifact row field ${String(key)} must be a date`);
}

function toIsoString(value: string | Date): string {
  return typeof value === "string" ? value : value.toISOString();
}
