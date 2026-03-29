import type { LinkSource, ServiceLinkRow, SyncState } from './repository';
export interface EffectiveLink {
    envName: string;
    source: LinkSource;
    syncState: SyncState;
    syncReason: string | null;
}
/**
 * Group link rows by normalized env name, picking the effective row per key
 * (manual wins over required). Returns the grouped map of selected rows.
 */
export declare function groupLinkRowsByEnvName(rows: ServiceLinkRow[]): Map<string, ServiceLinkRow>;
export declare function buildLinkStateByName(rows: ServiceLinkRow[]): Map<string, {
    syncState: SyncState;
    syncReason: string | null;
}>;
export declare function assertSpaceCommonEnvKeyAllowed(name: string): void;
/** Extract D1 meta.changes from a Drizzle run result */
export declare function getChanges(result: unknown): number;
export declare function getEffectiveLinks(rows: ServiceLinkRow[]): Map<string, EffectiveLink>;
//# sourceMappingURL=link-state.d.ts.map