import type { R2Bucket } from '../../../shared/types/bindings.ts';
export type PersistedUsageEvent = {
    meter_type: string;
    units: number;
    reference_type?: string | null;
    metadata?: string | null;
    created_at: string;
};
export declare const USAGE_EVENT_SEGMENT_SIZE = 200;
export declare function usageSegmentKey(runId: string, segmentIndex: number): string;
export declare function writeUsageEventSegmentToR2(bucket: R2Bucket, runId: string, segmentIndex: number, events: PersistedUsageEvent[]): Promise<void>;
export declare function getUsageEventsFromR2(bucket: R2Bucket, runId: string, options?: {
    maxEvents?: number;
}): Promise<PersistedUsageEvent[]>;
//# sourceMappingURL=usage-events.d.ts.map