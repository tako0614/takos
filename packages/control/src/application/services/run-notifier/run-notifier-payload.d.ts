export interface RunNotifierEmitPayload<TData = unknown> {
    runId: string;
    type: string;
    data: TData;
    event_id?: number;
}
export declare function buildRunNotifierEmitPayload<TData>(runId: string, type: string, data: TData, eventId?: number | null): RunNotifierEmitPayload<TData>;
//# sourceMappingURL=run-notifier-payload.d.ts.map