import type { Env, RunStatus } from '../../../shared/types';
import type { PersistedRunEvent } from '../../../application/services/offload/run-events';
export type FormattedRunEvent = {
    id: number;
    event_id: string;
    run_id: string;
    type: string;
    data: string;
    created_at: string;
};
export type RunObservation = {
    events: FormattedRunEvent[];
    runStatus: RunStatus;
};
export declare function deriveRunStatusFromTimelineEvents(fallbackStatus: RunStatus, events: PersistedRunEvent[]): RunStatus;
export declare function loadRunObservation(env: Env, runId: string, fallbackStatus: RunStatus, lastEventId: number): Promise<RunObservation>;
//# sourceMappingURL=observation.d.ts.map