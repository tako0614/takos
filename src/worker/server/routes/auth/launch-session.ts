// Launch-session helpers used by the internal launch-session endpoint
// (see takos/../../../web.ts).
//
// Centralizes:
// - LaunchSessionRequest / LaunchSessionUser shapes and parsing
// - issuer URL normalization
// - launch-session user resolution (find existing or provision)
// - workspace bootstrap for the launch's spaceId, if any
import type { Env } from "../../../shared/types/index.ts";
import { getDb } from "../../../infra/db/index.ts";
import { accounts, authIdentities } from "../../../infra/db/schema.ts";
import { provisionOidcUser, sanitizeReturnTo } from "./provisioning.ts";
import {
  createWorkspaceWithDefaultRepo,
  loadSpaceById,
} from "../../../application/services/identity/spaces.ts";
import { preinstallDefaultAppsForSpace } from "../../../application/services/source/default-app-distribution.ts";
import { eq } from "drizzle-orm";

export type LaunchSessionRequest = {
  issuer: string;
  subject: string;
  installationId: string;
  accountId?: string;
  spaceId?: string;
  appId?: string;
  role?: string;
  returnTo?: string;
};

export type LaunchSessionUser = {
  id: string;
  status: string;
  setupCompleted: boolean;
};

export function isLaunchSessionRequest(
  value: unknown,
): value is LaunchSessionRequest {
  if (!isPlainRecord(value)) return false;
  const issuer = normalizeIssuerUrl(readLaunchString(value, "issuer"));
  const subject = readLaunchString(value, "subject");
  const installationId = readLaunchString(value, "installation_id") ??
    readLaunchString(value, "installationId");
  if (!issuer || !subject || !installationId) return false;
  value.issuer = issuer;
  value.subject = subject;
  value.installationId = installationId;
  value.accountId = readLaunchString(value, "account_id") ??
    readLaunchString(value, "accountId");
  value.spaceId = readLaunchString(value, "space_id") ??
    readLaunchString(value, "spaceId");
  value.appId = readLaunchString(value, "app_id") ??
    readLaunchString(value, "appId");
  value.role = readLaunchString(value, "role");
  value.returnTo = readLaunchString(value, "return_to") ??
    readLaunchString(value, "returnTo");
  return true;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readLaunchString(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const field = value[key];
  return typeof field === "string" && field.trim() ? field.trim() : undefined;
}

export function normalizeIssuerUrl(
  value: string | null | undefined,
): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function launchSessionUser(
  db: ReturnType<typeof getDb>,
  userId: string,
): Promise<LaunchSessionUser | null> {
  const row = await db.select({
    id: accounts.id,
    status: accounts.status,
    setupCompleted: accounts.setupCompleted,
  }).from(accounts).where(eq(accounts.id, userId)).get();
  return row ?? null;
}

export async function provisionLaunchSessionUser(input: {
  dbBinding: Parameters<typeof provisionOidcUser>[0];
  subject: string;
  providerSub: string;
}): Promise<LaunchSessionUser> {
  const user = await provisionOidcUser(input.dbBinding, {
    subject: input.subject,
  });
  const timestamp = new Date().toISOString();
  const db = getDb(input.dbBinding);
  await db.update(accounts).set({
    setupCompleted: true,
    updatedAt: timestamp,
  }).where(eq(accounts.id, user.id));
  await db.insert(authIdentities).values({
    id: crypto.randomUUID(),
    userId: user.id,
    provider: "oidc",
    providerSub: input.providerSub,
    emailSnapshot: null,
    emailKind: "unknown",
    linkedAt: timestamp,
    lastLoginAt: timestamp,
  });
  return {
    id: user.id,
    status: "active",
    setupCompleted: true,
  };
}

function launchSessionSpaceReturnTo(body: LaunchSessionRequest): string | null {
  if (!body.spaceId) return null;
  const returnTo = sanitizeReturnTo(body.returnTo);
  return returnTo.startsWith(`/spaces/${body.spaceId}/`) ? returnTo : null;
}

export async function ensureLaunchSessionSpace(input: {
  env: Env;
  userId: string;
  body: LaunchSessionRequest;
}): Promise<string | null> {
  const returnTo = launchSessionSpaceReturnTo(input.body);
  if (!returnTo || !input.body.spaceId) return null;

  const existing = await loadSpaceById(input.env.DB, input.body.spaceId);
  if (existing) return returnTo;

  await createWorkspaceWithDefaultRepo(
    input.env,
    input.userId,
    "Takos Space",
    {
      id: input.body.spaceId,
      skipIdCheck: true,
      installDefaultApps: false,
    },
  );
  await preinstallDefaultAppsForSpace(input.env, {
    spaceId: input.body.spaceId,
    createdByAccountId: input.body.accountId ?? input.userId,
    subject: input.body.subject,
  });
  return returnTo;
}
