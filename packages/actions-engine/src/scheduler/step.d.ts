import type { Step, StepResult, ExecutionContext, ActionResolver } from '../workflow-models.js';
/**
 * Step runner options
 */
export interface StepRunnerOptions {
    /** Custom action resolver */
    actionResolver?: ActionResolver;
    /** Custom shell command executor */
    shellExecutor?: ShellExecutor;
    /** Default timeout in minutes */
    defaultTimeout?: number;
    /** Working directory */
    workingDirectory?: string;
    /** Default shell */
    defaultShell?: Step['shell'];
}
/**
 * Metadata for step execution
 */
export interface StepRunMetadata {
    /** Zero-based step index within its job */
    index?: number;
}
/**
 * Shell executor function type
 */
export type ShellExecutor = (command: string, options: ShellExecutorOptions) => Promise<ShellExecutorResult>;
/**
 * Shell executor options
 */
export interface ShellExecutorOptions {
    shell?: Step['shell'];
    workingDirectory?: string;
    env?: Record<string, string>;
    timeout?: number;
}
/**
 * Shell executor result
 */
export interface ShellExecutorResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}
/**
 * Step runner for executing individual steps
 */
export declare class StepRunner {
    private options;
    private actionResolver;
    private shellExecutor;
    constructor(options?: StepRunnerOptions);
    /**
     * Run a single step
     */
    runStep(step: Step, context: ExecutionContext, _metadata?: StepRunMetadata): Promise<StepResult>;
    /**
     * Run an action step
     */
    private runAction;
    /**
     * Run a shell command step
     */
    private runShell;
    private resolveRunnerTemp;
    private createCommandFiles;
    private parseCommandFileOutputs;
    private applyCommandFileEnvironmentUpdates;
    /** @see {@link MAX_COMMAND_FILE_BYTES} in constants.ts */
    private static readonly MAX_COMMAND_FILE_BYTES;
    private readCommandFile;
    private removeCommandFilesDirectory;
}
//# sourceMappingURL=step.d.ts.map