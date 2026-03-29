import type { DurableObjectNamespace, DurableObjectStub } from '../shared/types/bindings.ts';
export { createInMemoryD1Database } from './in-memory-d1.ts';
export { createInMemoryKVNamespace } from './in-memory-kv.ts';
export { createInMemoryR2Bucket } from './in-memory-r2.ts';
export { createInMemoryQueue } from './in-memory-queue.ts';
export type InMemoryDurableObjectNamespace = DurableObjectNamespace & {
    getByName(name: string): DurableObjectStub;
};
export declare function createInMemoryDurableObjectNamespace(factory?: (id: string) => DurableObjectStub): InMemoryDurableObjectNamespace;
//# sourceMappingURL=in-memory-bindings.d.ts.map