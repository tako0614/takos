import type { SqlDatabaseBinding } from '../../../shared/types/bindings.ts';
import type { Run, SpaceRole } from '../../../shared/types';
export type RunAccessResult = {
    run: Run;
    role: SpaceRole;
};
export declare function checkRunAccess(db: SqlDatabaseBinding, runId: string, userId: string, requiredRole?: SpaceRole[]): Promise<RunAccessResult | null>;
//# sourceMappingURL=access.d.ts.map