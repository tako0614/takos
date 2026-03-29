import type { Env } from '../../../shared/types';
import { type RunTerminalPayload } from './run-events-contract';
export interface PersistedRunFailedEvent {
    payload: RunTerminalPayload;
    eventId: number | null;
}
export interface PersistRunFailedEventOptions {
    error: string;
    createdAt: string;
    sessionId?: string | null;
    permanent?: boolean;
}
export declare function persistRunFailedEvent(env: Pick<Env, 'DB' | 'TAKOS_OFFLOAD'>, runId: string, options: PersistRunFailedEventOptions): Promise<PersistedRunFailedEvent>;
export declare function notifyRunFailedEvent(env: Pick<Env, 'RUN_NOTIFIER'>, runId: string, event: PersistedRunFailedEvent): Promise<void>;
//# sourceMappingURL=run-failure-events.d.ts.map