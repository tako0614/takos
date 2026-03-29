import type { CapabilityDescriptor, CapabilityKind, CapabilityNamespace } from './capability-types';
export declare class CapabilityRegistry {
    private descriptors;
    register(descriptor: CapabilityDescriptor): void;
    registerAll(descriptors: CapabilityDescriptor[]): void;
    all(): CapabilityDescriptor[];
    get(id: string): CapabilityDescriptor | undefined;
    byKind(kind: CapabilityKind): CapabilityDescriptor[];
    byNamespace(ns: CapabilityNamespace): CapabilityDescriptor[];
    byFamily(family: string): CapabilityDescriptor[];
    families(): {
        family: string;
        count: number;
    }[];
    search(query: string, opts?: {
        limit?: number;
    }): CapabilityDescriptor[];
    get size(): number;
}
//# sourceMappingURL=capability-registry.d.ts.map