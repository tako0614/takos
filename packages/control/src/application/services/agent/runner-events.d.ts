/**
 * Agent Runner Event Emission
 *
 * Event emission helpers for the AgentRunner, including sequencing,
 * DB persistence, and Durable Object relay.
 */
import type { Env } from '../../../shared/types';
import type { AgentEvent } from './agent-models';
import type { EventEmissionError } from './runner-utils';
import type { RunTerminalPayload } from '../run-notifier';
import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
export interface EventEmitterState {
    eventSequence: number;
    pendingEventEmissions: number;
    eventEmissionErrors: EventEmissionError[];
}
export declare function buildTerminalEventPayloadImpl(runId: string, status: 'completed' | 'failed' | 'cancelled', details: Record<string, unknown>, sessionId: string | null): RunTerminalPayload;
/**
 * Emit a sequenced event for the run (to DB and WebSocket).
 */
export declare function emitEventImpl(state: EventEmitterState, env: Env, db: SqlDatabaseBinding, runId: string, spaceId: string, getCurrentSessionId: () => Promise<string | null>, type: AgentEvent['type'], data: Record<string, unknown>, options?: {
    skipDb?: boolean;
}, remoteEmit?: (input: {
    runId: string;
    type: AgentEvent['type'];
    data: Record<string, unknown>;
    sequence: number;
    skipDb?: boolean;
}) => Promise<void>): Promise<void>;
//# sourceMappingURL=runner-events.d.ts.map