/**
 * Context management for workflow execution
 */
import type { ExecutionContext, GitHubContext, RunnerContext, InputsContext } from './workflow-models.js';
/**
 * Context builder options
 */
export interface ContextBuilderOptions {
    /** GitHub context overrides */
    github?: Partial<GitHubContext>;
    /** Runner context overrides */
    runner?: Partial<RunnerContext>;
    /** Environment variables */
    env?: Record<string, string>;
    /** Repository variables */
    vars?: Record<string, string>;
    /** Secrets */
    secrets?: Record<string, string>;
    /** Workflow dispatch inputs */
    inputs?: InputsContext;
}
/**
 * Create a base execution context
 */
export declare function createBaseContext(options?: ContextBuilderOptions): ExecutionContext;
/**
 * Parse GITHUB_ENV file format
 * Format:
 *   NAME=value
 *   or
 *   NAME<<EOF
 *   multiline
 *   value
 *   EOF
 */
export declare function parseGitHubEnvFile(content: string): Record<string, string>;
//# sourceMappingURL=context.d.ts.map