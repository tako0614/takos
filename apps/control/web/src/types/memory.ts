// Re-export types from backend shared models to avoid duplication.
// Frontend variants omit user-scoping fields not used in the UI.
import type {
  Memory as BackendMemory,
  Reminder as BackendReminder,
} from '@takos/control/shared/types';

/**
 * Frontend Memory: omits `user_id` and `thread_id` since the UI always
 * operates within an authenticated user/space context.
 */
export type Memory = Omit<BackendMemory, 'user_id' | 'thread_id'>;

/**
 * Frontend Reminder: omits `user_id` since the UI always operates within
 * an authenticated user context.
 */
export type Reminder = Omit<BackendReminder, 'user_id'>;
