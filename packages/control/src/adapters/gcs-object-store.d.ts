import type { R2Bucket } from '../../shared/types/bindings.ts';
export type GcsObjectStoreConfig = {
    bucket: string;
    projectId?: string;
    keyFilePath?: string;
};
export declare function createGcsObjectStore(config: GcsObjectStoreConfig): R2Bucket;
//# sourceMappingURL=gcs-object-store.d.ts.map