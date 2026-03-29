import type { LifecycleHooks, UpdateStrategy } from '../app-manifest-types';
export declare function validateSemver(version: string): void;
export declare function parseLifecycle(specRecord: Record<string, unknown>): LifecycleHooks | undefined;
export declare function parseUpdateStrategy(specRecord: Record<string, unknown>): UpdateStrategy | undefined;
export declare function validateDependsOn(dependsOn: string[] | undefined, prefix: string, allNames: Set<string>): void;
//# sourceMappingURL=parse-common.d.ts.map