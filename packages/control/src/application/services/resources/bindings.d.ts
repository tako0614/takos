import type { D1Database } from '../../../shared/types/bindings.ts';
export declare function listServiceBindings(db: D1Database, resourceId: string): Promise<{
    service_hostname: string | null;
    service_slug: string | null;
    service_status: string | null;
    id: string;
    service_id: string;
    resource_id: string;
    binding_name: string;
    binding_type: import("../../../shared/types/services-resources.ts").BindingType;
    config: string;
    created_at: string;
}[]>;
export declare function countServiceBindings(db: D1Database, resourceId: string): Promise<{
    count: number;
}>;
export declare function createServiceBinding(db: D1Database, input: {
    id: string;
    service_id: string;
    resource_id: string;
    binding_name: string;
    binding_type: string;
    config: Record<string, unknown>;
    created_at: string;
}): Promise<void>;
export declare function deleteServiceBinding(db: D1Database, resourceId: string, serviceId: string): Promise<void>;
export declare const listResourceBindings: typeof listServiceBindings;
export declare const countResourceBindings: typeof countServiceBindings;
export declare const createWorkerBinding: typeof createServiceBinding;
export declare const deleteWorkerBinding: typeof deleteServiceBinding;
export declare function buildBindingFromResource(db: D1Database, resourceId: string, bindingName: string): Promise<{
    type: 'd1' | 'r2' | 'kv' | 'queue' | 'analytics_engine' | 'workflow' | 'vectorize' | 'durable_object_namespace';
    name: string;
    id?: string;
    bucket_name?: string;
    namespace_id?: string;
    queue_name?: string;
    dataset?: string;
    workflow_name?: string;
    index_name?: string;
    class_name?: string;
    script_name?: string;
} | null>;
//# sourceMappingURL=bindings.d.ts.map