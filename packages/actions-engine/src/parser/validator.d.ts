import type { Workflow, WorkflowDiagnostic } from '../workflow-models.js';
/**
 * Validation result
 */
export interface ValidationResult {
    valid: boolean;
    diagnostics: WorkflowDiagnostic[];
}
/**
 * Validate workflow against schema
 */
export declare function validateWorkflow(workflow: Workflow): ValidationResult;
//# sourceMappingURL=validator.d.ts.map