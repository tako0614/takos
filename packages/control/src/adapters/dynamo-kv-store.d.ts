import type { KVNamespace } from '../../shared/types/bindings.ts';
export type DynamoKvStoreConfig = {
    region: string;
    tableName: string;
    accessKeyId?: string;
    secretAccessKey?: string;
};
export declare function createDynamoKvStore(config: DynamoKvStoreConfig): KVNamespace;
//# sourceMappingURL=dynamo-kv-store.d.ts.map