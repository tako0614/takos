export interface SseNotifierService {
    /** Emit an event to a channel (e.g., "run:{runId}" or "notifications:{userId}") */
    emit(channel: string, event: {
        type: string;
        data: unknown;
        event_id?: number;
    }): void;
    /** Subscribe to a channel, returning a ReadableStream of SSE-formatted data */
    subscribe(channel: string, lastEventId?: number): ReadableStream<Uint8Array>;
    /** Dispose of resources (Redis connections) */
    dispose(): Promise<void>;
}
export declare function createSseNotifierService(redisUrl?: string): Promise<SseNotifierService>;
//# sourceMappingURL=sse-notifier.d.ts.map