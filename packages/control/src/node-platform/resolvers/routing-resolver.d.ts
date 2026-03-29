export declare function resolveRoutingStore(redisUrl: string | null, dataDir: string | null): import("../../shared/types/routing.ts").RoutingStore;
export declare function resolveSseNotifier(redisUrl: string | null): Promise<import("../../worker-emulation/sse-notifier.ts").SseNotifierService | undefined>;
export declare function ensureRoutingSeeded(getSharedState: () => Promise<{
    hostnameRouting: {
        put(key: string, value: string): Promise<void>;
    };
    routingStore: {
        putRecord(hostname: string, target: unknown, timestamp: number): Promise<unknown>;
    };
}>): Promise<void>;
/**
 * Reset the seeded flag — called during state disposal.
 */
export declare function resetRoutingSeed(): void;
//# sourceMappingURL=routing-resolver.d.ts.map