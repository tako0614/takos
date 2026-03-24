/**
 * Durable Object Alarm Manager.
 *
 * Shared alarm scheduling and cleanup logic extracted from
 * session.ts and run-notifier.ts Durable Objects.
 *
 * Both DOs follow the same pattern for alarm management:
 * - session.ts: `scheduleCleanupAlarm()` finds the earliest expiry across
 *   sessions/oidcStates and sets an alarm at that time (with a floor of
 *   `Date.now() + 1000`).
 * - run-notifier.ts: `scheduleAlarm()` checks if an alarm exists and, if
 *   not, sets one at `Date.now() + HEARTBEAT_INTERVAL_MS`.
 *
 * This class consolidates the alarm API interactions into a reusable utility.
 */

/**
 * Abstraction over the alarm-related subset of `DurableObjectStorage`.
 */
export interface AlarmManagerStorage {
  getAlarm(): Promise<number | null>;
  setAlarm(scheduledTime: number | Date): Promise<void>;
  deleteAlarm(): Promise<void>;
}

/**
 * Manages Durable Object alarms with common scheduling patterns.
 *
 * @example
 * ```ts
 * const alarms = new DOAlarmManager(ctx.storage);
 *
 * // Schedule at earliest of current alarm and new time (session.ts pattern)
 * await alarms.scheduleAtEarliest(earliestExpiry);
 *
 * // Schedule if no alarm exists (run-notifier.ts pattern)
 * await alarms.scheduleIfNone(Date.now() + HEARTBEAT_INTERVAL_MS);
 *
 * // Schedule at a relative offset from now
 * await alarms.scheduleIn(60_000);
 * ```
 */
export class DOAlarmManager {
  private storage: AlarmManagerStorage;

  constructor(storage: AlarmManagerStorage) {
    this.storage = storage;
  }

  /**
   * Schedule alarm at the earliest of the current alarm and the new time.
   *
   * This matches the pattern used by `SessionDO.scheduleCleanupAlarm()`:
   * if no alarm is set or the new time is earlier, the alarm is updated.
   *
   * @param time - The desired alarm time (epoch ms or Date).
   */
  async scheduleAtEarliest(time: number | Date): Promise<void> {
    const scheduledMs = typeof time === 'number' ? time : time.getTime();
    const currentAlarm = await this.storage.getAlarm();
    if (currentAlarm === null || scheduledMs < currentAlarm) {
      await this.storage.setAlarm(scheduledMs);
    }
  }

  /**
   * Schedule alarm only if no alarm is currently set.
   *
   * This matches the pattern used by `RunNotifierDO.scheduleAlarm()`:
   * ```ts
   * const currentAlarm = await this.state.storage.getAlarm();
   * if (!currentAlarm) {
   *   await this.state.storage.setAlarm(Date.now() + HEARTBEAT_INTERVAL_MS);
   * }
   * ```
   *
   * @param time - The desired alarm time (epoch ms or Date).
   */
  async scheduleIfNone(time: number | Date): Promise<void> {
    const currentAlarm = await this.storage.getAlarm();
    if (currentAlarm !== null) return;
    const scheduledMs = typeof time === 'number' ? time : time.getTime();
    await this.storage.setAlarm(scheduledMs);
  }

  /**
   * Schedule alarm at a relative offset from now.
   *
   * Delegates to `scheduleAtEarliest` so that an earlier existing alarm
   * is not pushed back.
   *
   * @param delayMs - Milliseconds from now.
   */
  async scheduleIn(delayMs: number): Promise<void> {
    await this.scheduleAtEarliest(Date.now() + delayMs);
  }

  /**
   * Schedule alarm at a relative offset from now, only if no alarm is set.
   *
   * @param delayMs - Milliseconds from now.
   */
  async scheduleInIfNone(delayMs: number): Promise<void> {
    await this.scheduleIfNone(Date.now() + delayMs);
  }

  /**
   * Cancel the current alarm.
   */
  async cancel(): Promise<void> {
    await this.storage.deleteAlarm();
  }

  /**
   * Check if an alarm is currently scheduled.
   */
  async isScheduled(): Promise<boolean> {
    const alarm = await this.storage.getAlarm();
    return alarm !== null;
  }

  /**
   * Get the currently scheduled alarm time, if any.
   *
   * @returns Epoch milliseconds of the scheduled alarm, or `null`.
   */
  async getScheduledTime(): Promise<number | null> {
    return this.storage.getAlarm();
  }
}
