/**
 * Google Cloud Firestore implementation of the Cloudflare KVNamespace
 * binding interface.
 *
 * Each key is stored as a Firestore document in the configured collection.
 * TTL is handled both by Firestore's native TTL policy (for automatic
 * cleanup) and by manual expiration checks on read (to handle the TTL
 * propagation lag).
 */
import type { KVNamespace } from '../shared/types/bindings.ts';
export type FirestoreKvStoreConfig = {
    projectId?: string;
    keyFilePath?: string;
    /** Firestore collection name to store KV entries. */
    collectionName: string;
};
export declare function createFirestoreKvStore(config: FirestoreKvStoreConfig): KVNamespace;
//# sourceMappingURL=firestore-kv-store.d.ts.map