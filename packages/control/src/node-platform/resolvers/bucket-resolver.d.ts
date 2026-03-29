export declare const BUCKET_NAMES: readonly ["GIT_OBJECTS", "TAKOS_OFFLOAD", "TENANT_SOURCE", "WORKER_BUNDLES", "TENANT_BUILDS", "UI_BUNDLES"];
export type BucketName = (typeof BUCKET_NAMES)[number];
export declare function resolveBucket(name: BucketName, dataDir: string | null): Promise<import("@cloudflare/workers-types").R2Bucket>;
//# sourceMappingURL=bucket-resolver.d.ts.map