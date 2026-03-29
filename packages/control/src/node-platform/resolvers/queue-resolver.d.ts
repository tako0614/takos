export type QueueName = 'RUN' | 'INDEX' | 'WORKFLOW' | 'DEPLOY';
export declare function resolveQueue<T = unknown>(name: QueueName, redisUrl: string | null, dataDir: string | null): Promise<import("../../shared/types/bindings.ts").Queue<T>>;
//# sourceMappingURL=queue-resolver.d.ts.map