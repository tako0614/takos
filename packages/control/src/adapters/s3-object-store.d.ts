import type { R2Bucket } from '../../shared/types/bindings.ts';
export type S3ObjectStoreConfig = {
    region: string;
    bucket: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    endpoint?: string;
};
export declare function createS3ObjectStore(config: S3ObjectStoreConfig): R2Bucket;
//# sourceMappingURL=s3-object-store.d.ts.map