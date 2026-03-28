// Re-export types from backend shared models to avoid duplication.
import type { User as BackendUser } from '@takoserver/control/shared/types';

/**
 * Frontend User: picks the fields needed by the UI layer.
 * Backend-only fields (id, principal_id, principal_kind, bio, trust_tier,
 * created_at, updated_at) are omitted.
 */
export type User = Pick<BackendUser, 'email' | 'name' | 'username' | 'picture' | 'setup_completed'>;

/** Frontend-only: user preferences returned by the settings API. */
export interface UserSettings {
  setup_completed: boolean;
  auto_update_enabled: boolean;
  private_account: boolean;
  activity_visibility: 'public' | 'followers' | 'private';
  ai_model: string;
  available_models: string[];
}
