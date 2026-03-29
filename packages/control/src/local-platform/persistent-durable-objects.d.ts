import type { DurableObjectStub } from '../shared/types/bindings.ts';
import { type InMemoryDurableObjectNamespace } from './in-memory-bindings.ts';
export declare function createPersistentDurableObjectNamespace(stateFile: string, factory?: (id: string) => DurableObjectStub): InMemoryDurableObjectNamespace;
//# sourceMappingURL=persistent-durable-objects.d.ts.map