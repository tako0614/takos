import type { Env } from '../../shared/types';
export declare class RunNotifierDO implements DurableObject {
    private state;
    private db;
    private offloadBucket;
    private connections;
    private runId;
    private eventBuffer;
    private eventIdCounter;
    private r2SegmentIndex;
    private r2SegmentBuffer;
    private r2LastFlushedSegmentIndex;
    private usageSegmentIndex;
    private usageSegmentBuffer;
    private usageLastFlushedSegmentIndex;
    /**
     * Hard cap on segment buffer sizes to prevent unbounded growth
     * if R2 writes consistently fail. When the cap is reached, oldest
     * entries are dropped and a warning is logged.
     */
    private static readonly MAX_SEGMENT_BUFFER_SIZE;
    constructor(state: DurableObjectState, env: Env);
    alarm(): Promise<void>;
    private cleanupStaleConnections;
    private broadcastHeartbeat;
    private broadcastMessage;
    private scheduleAlarm;
    private persistState;
    /**
     * Enforce the hard cap on a segment buffer. If the buffer exceeds
     * MAX_SEGMENT_BUFFER_SIZE, the oldest entries are dropped to make room.
     * This prevents unbounded memory growth when R2 writes repeatedly fail.
     */
    private enforceSegmentBufferCap;
    private stringifyPersistedData;
    private isSegmentBoundaryOrTerminal;
    private flushR2Segment;
    private flushUsageSegment;
    private persistLastEventId;
    fetch(request: Request): Promise<Response>;
    private handleWebSocket;
    webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void>;
    webSocketClose(ws: WebSocket): Promise<void>;
    webSocketError(ws: WebSocket, error: unknown): Promise<void>;
    private handleEmit;
    private handleUsage;
}
//# sourceMappingURL=run-notifier.d.ts.map