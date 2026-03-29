import { type Workflow } from 'takos-actions-engine';
import type { AppResource, AppWorker } from './app-manifest-types';
/** Minimal service shape used by resource validation (supports both workers and containers) */
type ValidatableService = {
    type: 'worker' | 'container';
    bindings?: AppWorker['bindings'];
    triggers?: AppWorker['triggers'];
};
export declare function parseAndValidateWorkflowYaml(raw: string, workflowPath: string): Workflow;
export declare function validateDeployProducerJob(workflow: Workflow, workflowPath: string, jobKey: string): void;
export declare function parseResources(specRecord: Record<string, unknown>, services: Record<string, ValidatableService>): Record<string, AppResource>;
export declare function validateResourceBindings(services: Record<string, ValidatableService>, resources: Record<string, AppResource>): void;
export {};
//# sourceMappingURL=app-manifest-validation.d.ts.map