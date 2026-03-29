import type { WorkflowDiagnostic } from 'takos-actions-engine';
export declare function asRecord(value: unknown): Record<string, unknown>;
export declare function asString(value: unknown, field: string): string | undefined;
export declare function asRequiredString(value: unknown, field: string): string;
export declare function asStringArray(value: unknown, field: string): string[] | undefined;
export declare function asStringMap(value: unknown, field: string): Record<string, string> | undefined;
export declare function asOptionalInteger(value: unknown, field: string, options?: {
    min?: number;
}): number | undefined;
export declare function normalizeRepoPath(path: string): string;
export declare function filterWorkflowErrors(diagnostics: WorkflowDiagnostic[]): WorkflowDiagnostic[];
//# sourceMappingURL=app-manifest-utils.d.ts.map