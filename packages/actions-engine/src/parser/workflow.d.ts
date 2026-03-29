import type { Workflow, ParsedWorkflow, WorkflowDiagnostic } from '../workflow-models.js';
/**
 * Error thrown when workflow parsing fails
 */
export declare class WorkflowParseError extends Error {
    readonly diagnostics: WorkflowDiagnostic[];
    constructor(message: string, diagnostics: WorkflowDiagnostic[]);
}
/**
 * Parse YAML workflow content
 *
 * @param content - YAML content string
 * @returns Parsed workflow with diagnostics
 */
export declare function parseWorkflow(content: string): ParsedWorkflow;
/**
 * Parse workflow from file path (for Node.js environments)
 *
 * @param filePath - Path to workflow file
 * @returns Parsed workflow
 */
export declare function parseWorkflowFile(filePath: string): Promise<ParsedWorkflow>;
/**
 * Stringify workflow back to YAML
 *
 * @param workflow - Workflow object
 * @returns YAML string
 */
export declare function stringifyWorkflow(workflow: Workflow): string;
//# sourceMappingURL=workflow.d.ts.map