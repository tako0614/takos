import { and, desc, eq, ne, or, sql } from "drizzle-orm";

import type {
  Workspace,
  WorkspacePersistence,
} from "../../../core/workspaces/index.ts";
import {
  accountMemberships,
  accounts,
  getDb,
  type SqlDatabaseLike,
} from "../../infra/db/index.ts";

export interface SqlWorkspacePersistenceOptions {
  nextLegacyWitnessId?: () => string;
}

export interface SqlWorkspaceModelSettingsUpdate {
  model?: string;
  backend?: string;
  updatedAt: string;
}

type WorkspaceRow = {
  id: string;
  type: string;
  name: string;
  slug: string;
  description: string | null;
  securityPosture: string | null;
  createdAt: string;
  updatedAt: string;
};

function toWorkspace(row: WorkspaceRow, principalId: string): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    isDefault: row.type === "user" && row.id === principalId,
    securityPosture: row.securityPosture === "restricted_egress"
      ? "restricted_egress"
      : "standard",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function isActivePrincipal(
  db: ReturnType<typeof getDb>,
  principalId: string,
): Promise<boolean> {
  const principal = await db.select({ id: accounts.id }).from(accounts).where(
    and(
      eq(accounts.id, principalId),
      eq(accounts.type, "user"),
      eq(accounts.status, "active"),
    ),
  ).limit(1).get();
  return principal?.id === principalId;
}

function ownerConditions(principalId: string) {
  return and(
    eq(accountMemberships.memberId, principalId),
    eq(accountMemberships.role, "owner"),
    eq(accountMemberships.status, "active"),
    eq(accounts.status, "active"),
    or(
      eq(accounts.type, "team"),
      and(eq(accounts.type, "user"), eq(accounts.id, principalId)),
    ),
    or(
      eq(accounts.ownerAccountId, principalId),
      and(eq(accounts.type, "user"), eq(accounts.id, principalId)),
    ),
  );
}

function authorizedAccountMutation(
  principalId: string,
  workspaceId: string,
) {
  return and(
    eq(accounts.id, workspaceId),
    eq(accounts.status, "active"),
    or(
      eq(accounts.type, "team"),
      and(eq(accounts.type, "user"), eq(accounts.id, principalId)),
    ),
    or(
      eq(accounts.ownerAccountId, principalId),
      and(eq(accounts.type, "user"), eq(accounts.id, principalId)),
    ),
    sql`EXISTS (
      SELECT 1 FROM account_memberships AS owner_witness
      WHERE owner_witness.account_id = ${accounts.id}
        AND owner_witness.member_id = ${principalId}
        AND owner_witness.role = 'owner'
        AND owner_witness.status = 'active'
    )`,
    sql`EXISTS (
      SELECT 1 FROM accounts AS principal
      WHERE principal.id = ${principalId}
        AND principal.type = 'user'
        AND principal.status = 'active'
    )`,
  );
}

const workspaceSelection = {
  id: accounts.id,
  type: accounts.type,
  name: accounts.name,
  slug: accounts.slug,
  description: accounts.description,
  securityPosture: accounts.securityPosture,
  createdAt: accounts.createdAt,
  updatedAt: accounts.updatedAt,
};

export function createSqlWorkspacePersistence(
  database: SqlDatabaseLike,
  options: SqlWorkspacePersistenceOptions = {},
): WorkspacePersistence {
  const db = getDb(database);
  const nextLegacyWitnessId = options.nextLegacyWitnessId ?? (() =>
    crypto.randomUUID());

  return {
    async isWorkspaceIdAvailable(id) {
      const row = await db.select({ id: accounts.id }).from(accounts)
        .where(eq(accounts.id, id)).limit(1).get();
      return !row;
    },

    async isWorkspaceSlugAvailable(slug) {
      const row = await db.select({ id: accounts.id }).from(accounts)
        .where(eq(accounts.slug, slug)).limit(1).get();
      return !row;
    },

    async createForPrincipal(principalId, workspace) {
      if (!(await isActivePrincipal(db, principalId))) {
        throw new Error("Active Principal not found");
      }

      await db.batch([
        db.insert(accounts).values({
          id: workspace.id,
          type: "team",
          status: "active",
          name: workspace.name,
          slug: workspace.slug,
          description: workspace.description,
          ownerAccountId: principalId,
          aiModel: "gpt-5.5",
          modelBackend: "openai",
          securityPosture: workspace.securityPosture,
          createdAt: workspace.createdAt,
          updatedAt: workspace.updatedAt,
        }),
        db.insert(accountMemberships).values({
          id: nextLegacyWitnessId(),
          accountId: workspace.id,
          memberId: principalId,
          role: "owner",
          status: "active",
          createdAt: workspace.createdAt,
          updatedAt: workspace.updatedAt,
        }),
      ]);
      return workspace;
    },

    async listForPrincipal(principalId) {
      if (!(await isActivePrincipal(db, principalId))) return [];

      const rows = await db.select(workspaceSelection)
        .from(accountMemberships)
        .innerJoin(accounts, eq(accounts.id, accountMemberships.accountId))
        .where(ownerConditions(principalId))
        .orderBy(desc(accounts.updatedAt))
        .all();
      return rows.map((row) => toWorkspace(row, principalId));
    },

    async resolveForPrincipal(principalId, idOrSlug) {
      if (!(await isActivePrincipal(db, principalId))) return null;

      const selector = idOrSlug === "me"
        ? and(eq(accounts.id, principalId), eq(accounts.type, "user"))
        : or(eq(accounts.id, idOrSlug), eq(accounts.slug, idOrSlug));
      const row = await db.select(workspaceSelection)
        .from(accountMemberships)
        .innerJoin(accounts, eq(accounts.id, accountMemberships.accountId))
        .where(and(ownerConditions(principalId), selector))
        .limit(1)
        .get();
      return row ? toWorkspace(row, principalId) : null;
    },

    async updateForPrincipal(principalId, workspaceId, updates) {
      await db.update(accounts).set({
        ...(updates.name === undefined ? {} : { name: updates.name }),
        ...(updates.description === undefined
          ? {}
          : { description: updates.description }),
        ...(updates.securityPosture === undefined
          ? {}
          : { securityPosture: updates.securityPosture }),
        updatedAt: updates.updatedAt,
      }).where(authorizedAccountMutation(principalId, workspaceId));

      return await this.resolveForPrincipal(principalId, workspaceId);
    },

    async deleteForPrincipal(principalId, workspaceId) {
      const current = await this.resolveForPrincipal(principalId, workspaceId);
      if (!current || current.isDefault) return false;

      await db.batch([
        db.delete(accounts).where(and(
          authorizedAccountMutation(principalId, workspaceId),
          ne(accounts.type, "user"),
        )),
        db.delete(accountMemberships).where(and(
          eq(accountMemberships.accountId, workspaceId),
          sql`NOT EXISTS (
            SELECT 1 FROM accounts AS retained_workspace
            WHERE retained_workspace.id = ${workspaceId}
          )`,
        )),
      ]);

      return await this.isWorkspaceIdAvailable(workspaceId);
    },
  };
}

/** Worker-only projection update kept outside the neutral Workspace core. */
export async function updateSqlWorkspaceModelSettings(
  database: SqlDatabaseLike,
  principalId: string,
  workspaceId: string,
  updates: SqlWorkspaceModelSettingsUpdate,
): Promise<boolean> {
  if (updates.model === undefined && updates.backend === undefined) return false;

  const db = getDb(database);
  await db.update(accounts).set({
    ...(updates.model === undefined ? {} : { aiModel: updates.model }),
    ...(updates.backend === undefined
      ? {}
      : { modelBackend: updates.backend }),
    updatedAt: updates.updatedAt,
  }).where(authorizedAccountMutation(principalId, workspaceId));

  const row = await db.select({
    id: accounts.id,
    model: accounts.aiModel,
    backend: accounts.modelBackend,
  }).from(accounts).where(
    authorizedAccountMutation(principalId, workspaceId),
  ).limit(1).get();

  return row?.id === workspaceId &&
    (updates.model === undefined || row.model === updates.model) &&
    (updates.backend === undefined || row.backend === updates.backend);
}
