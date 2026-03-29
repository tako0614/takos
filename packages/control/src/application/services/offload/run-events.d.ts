import type { R2Bucket } from '../../../shared/types/bindings.ts';
export interface PersistedRunEvent {
    event_id: number;
    type: string;
    data: string;
    created_at: string;
}
export declare const RUN_EVENT_SEGMENT_SIZE = 100;
export declare function segmentIndexForEventId(eventId: number): number;
export declare function buildRunEventSegmentKey(runId: string, segmentIndex: number): string;
export declare function writeRunEventSegmentToR2(bucket: R2Bucket, runId: string, segmentIndex: number, events: PersistedRunEvent[]): Promise<void>;
export declare function listRunEventSegmentIndexes(bucket: R2Bucket, runId: string): Promise<number[]>;
export declare function readRunEventSegmentFromR2(bucket: R2Bucket, runId: string, segmentIndex: number): Promise<PersistedRunEvent[] | null>;
export declare function getRunEventsAfterFromR2(bucket: R2Bucket, runId: string, afterEventId: number, limit?: number): Promise<PersistedRunEvent[]>;
//# sourceMappingURL=run-events.d.ts.map