/**
 * Routing Cache
 *
 * L1 (isolate-local Map) and L2 (KV) cache management,
 * KV payload building, and Durable Object interaction helpers.
 */
import type { ParsedRoutingValue, ResolvedRouting, RoutingBindings, RoutingRecord, RoutingTarget } from './routing-models';
import type { PlatformExecutionContext } from '../../../shared/types/bindings.ts';
export declare const ROUTING_LOG_PREFIX = "[Routing]";
export declare const L2_KV_TTL_SECONDS = 120;
export declare const DEFAULT_DO_TIMEOUT_MS = 1000;
export declare const DEFAULT_TOMBSTONE_TTL_MS: number;
type RoutingNamespace = NonNullable<RoutingBindings['ROUTING_DO']>;
export type RoutingEnvWithDo = RoutingBindings & {
    ROUTING_DO: RoutingNamespace;
};
export declare function hasRoutingDO(env: RoutingBindings): env is RoutingEnvWithDo;
export declare function hasRoutingStore(env: RoutingBindings): env is RoutingBindings & {
    ROUTING_STORE: NonNullable<RoutingBindings['ROUTING_STORE']>;
};
export declare function putL1(hostname: string, value: ResolvedRouting, nowMs: number): void;
export declare function getL1(hostname: string, nowMs: number): ResolvedRouting | null;
export declare function buildKVPayload(options: {
    target: RoutingTarget | null;
    updatedAt: number;
    version?: number;
    tombstoneUntil?: number;
}): string;
export declare function shouldUseKvValue(parsed: ParsedRoutingValue, nowMs: number): boolean;
export declare function doGetRecord(env: RoutingEnvWithDo, hostname: string, timeoutMs: number): Promise<RoutingRecord | null>;
export declare function doPutRecord(env: RoutingEnvWithDo, hostname: string, target: RoutingTarget, updatedAt: number, timeoutMs: number): Promise<void>;
export declare function doDeleteRecord(env: RoutingEnvWithDo, hostname: string, tombstoneTtlMs: number, updatedAt: number, timeoutMs: number): Promise<void>;
/**
 * Run a task in the background via waitUntil if available, otherwise await it.
 */
export declare function runBackground(ctx: PlatformExecutionContext | undefined, task: Promise<unknown>): Promise<void>;
export {};
//# sourceMappingURL=cache.d.ts.map