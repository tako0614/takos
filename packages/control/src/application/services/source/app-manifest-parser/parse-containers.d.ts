import type { AppContainer, HealthCheck, Volume } from '../app-manifest-types';
export declare function parseHealthCheck(raw: unknown, prefix: string): HealthCheck | undefined;
export declare function parseVolumes(raw: unknown, prefix: string): Volume[] | undefined;
export declare function parseContainers(specRecord: Record<string, unknown>): Record<string, AppContainer>;
//# sourceMappingURL=parse-containers.d.ts.map