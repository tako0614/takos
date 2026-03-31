import type { D1Database } from '../../../shared/types/bindings.ts';
import { getDb, accountSettings } from '../../../infra/db/index.ts';
import { eq } from 'drizzle-orm';
import { isValidOpaqueId } from '../../../shared/utils/db-guards.ts';
import { DEFAULT_MODEL_ID, SUPPORTED_MODEL_IDS } from '../agent/index.ts';

export interface UserSettingsRow {
  userId: string;
  setupCompleted: boolean;
  autoUpdateEnabled: boolean;
  privateAccount: boolean;
  activityVisibility: string;
  aiModel: string | null;
  createdAt: string;
  updatedAt: string;
}

export const AI_MODELS = SUPPORTED_MODEL_IDS;
export type AIModel = typeof AI_MODELS[number];
export const DEFAULT_AI_MODEL: AIModel = DEFAULT_MODEL_ID as AIModel;

export async function getUserSettings(db: D1Database, userId: string): Promise<UserSettingsRow | null> {
  if (!isValidOpaqueId(userId)) return null;

  const drizzle = getDb(db);
  const row = await drizzle.select().from(accountSettings).where(eq(accountSettings.accountId, userId)).get();

  if (!row) return null;
  return {
    userId: row.accountId,
    setupCompleted: row.setupCompleted,
    autoUpdateEnabled: row.autoUpdateEnabled,
    privateAccount: row.privateAccount,
    activityVisibility: row.activityVisibility,
    aiModel: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function ensureUserSettings(db: D1Database, userId: string): Promise<UserSettingsRow> {
  if (!isValidOpaqueId(userId)) {
    return {
      userId,
      setupCompleted: false,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: 'public',
      aiModel: null,
      createdAt: '',
      updatedAt: '',
    };
  }

  const drizzle = getDb(db);
  let row = await drizzle.select().from(accountSettings).where(eq(accountSettings.accountId, userId)).get();

  if (!row) {
    try {
      row = await drizzle.insert(accountSettings).values({
        accountId: userId,
        setupCompleted: false,
        autoUpdateEnabled: true,
        privateAccount: false,
        activityVisibility: 'public',
      }).returning().get();
    } catch {
      // Race condition: another request created it first
      row = await drizzle.select().from(accountSettings).where(eq(accountSettings.accountId, userId)).get();
    }
  }

  if (!row) {
    return {
      userId,
      setupCompleted: false,
      autoUpdateEnabled: true,
      privateAccount: false,
      activityVisibility: 'public',
      aiModel: null,
      createdAt: '',
      updatedAt: '',
    };
  }

  return {
    userId: row.accountId,
    setupCompleted: row.setupCompleted,
    autoUpdateEnabled: row.autoUpdateEnabled,
    privateAccount: row.privateAccount,
    activityVisibility: row.activityVisibility,
    aiModel: null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function updateUserSettings(
  db: D1Database,
  userId: string,
  updates: {
    setup_completed?: boolean;
    auto_update_enabled?: boolean;
    private_account?: boolean;
    activity_visibility?: string;
  }
): Promise<UserSettingsRow | null> {
  if (!isValidOpaqueId(userId)) {
    return null;
  }

  await ensureUserSettings(db, userId);

  const drizzle = getDb(db);
  const data: Record<string, unknown> = {};

  if (updates.setup_completed !== undefined) {
    data.setupCompleted = updates.setup_completed;
  }
  if (updates.auto_update_enabled !== undefined) {
    data.autoUpdateEnabled = updates.auto_update_enabled;
  }
  if (updates.private_account !== undefined) {
    data.privateAccount = updates.private_account;
  }
  if (updates.activity_visibility !== undefined) {
    data.activityVisibility = String(updates.activity_visibility);
  }

  if (Object.keys(data).length > 0) {
    await drizzle.update(accountSettings).set(data).where(eq(accountSettings.accountId, userId));
  }

  return getUserSettings(db, userId);
}

export function formatUserSettingsResponse(settings: UserSettingsRow | null) {
  return {
    setup_completed: !!settings?.setupCompleted,
    auto_update_enabled: !!settings?.autoUpdateEnabled,
    private_account: !!settings?.privateAccount,
    activity_visibility: settings?.activityVisibility || 'public',
    ai_model: settings?.aiModel || DEFAULT_AI_MODEL,
    available_models: AI_MODELS,
  };
}
