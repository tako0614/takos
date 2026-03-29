/**
 * Shared helpers for KV store adapter implementations (DynamoDB, Firestore,
 * etc.).  These functions are backend-agnostic — they handle value coercion,
 * serialisation, TTL arithmetic and metadata parsing that every adapter needs.
 */
/** The `type` parameter accepted by `KVNamespace.get()`. */
export type KVValueType = 'text' | 'json' | 'arrayBuffer' | 'stream';
/** Shape returned by `KVNamespace.getWithMetadata()`. */
export type KVGetWithMetadataResult = {
    value: unknown;
    metadata: Record<string, string> | null;
    cacheStatus: null;
};
/** Shape of a single key entry returned by `KVNamespace.list()`. */
export type KVListKey = {
    name: string;
    expiration?: number;
    metadata?: Record<string, string>;
};
/** Shape returned by `KVNamespace.list()`. */
export type KVListResult = {
    keys: KVListKey[];
    list_complete: boolean;
    cursor?: string;
};
/** Current time as a Unix epoch (seconds). */
export declare function nowEpoch(): number;
/**
 * Return `true` when an expiration timestamp indicates the entry has expired.
 * Handles the various shapes backends hand us (string from DynamoDB
 * `AttributeValue.N`, number from Firestore, or undefined/null).
 */
export declare function isExpired(expiration: string | number | null | undefined): boolean;
/**
 * Derive the epoch-seconds expiration value from `put()` options.
 * Returns `null` when no expiration is configured.
 */
export declare function computeExpiration(options?: {
    expiration?: number;
    expirationTtl?: number;
}): number | null;
/**
 * Coerce a raw string value from the backing store into the requested type.
 *
 * Return type is declared as `unknown` because the actual JS type varies by
 * `type` parameter — callers cast as needed to satisfy the KVNamespace
 * overloads.
 */
export declare function coerceValue(raw: string, type?: KVValueType): unknown;
/**
 * Serialise an incoming value (string, ArrayBuffer or ReadableStream) into a
 * plain string suitable for storage.
 */
export declare function serializeValue(value: string | ArrayBuffer | ReadableStream): Promise<string>;
/**
 * Deserialise a metadata value. DynamoDB stores it as a JSON string;
 * Firestore stores it as a native map. This helper normalises both shapes.
 */
export declare function deserializeMetadata(raw: string | Record<string, string> | null | undefined): Record<string, string> | null;
//# sourceMappingURL=kv-store-shared.d.ts.map