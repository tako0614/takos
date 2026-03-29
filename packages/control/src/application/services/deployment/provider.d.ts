import { type WorkerBinding, WFPService } from '../../../platform/providers/cloudflare/wfp.ts';
import type { Deployment, DeploymentProviderName, DeploymentProviderRef, DeploymentTarget } from './models';
export type DeploymentProviderDeployResult = {
    resolvedEndpoint?: {
        kind: 'http-url';
        base_url: string;
    };
    logsRef?: string;
};
export type DeploymentProviderDeployInput = {
    deployment: Deployment;
    artifactRef: string;
    bundleContent?: string;
    wasmContent: ArrayBuffer | null;
    bindings: WorkerBinding[];
    compatibilityDate: string;
    compatibilityFlags: string[];
    limits?: {
        cpu_ms?: number;
        subrequests?: number;
    };
};
export type DeploymentProvider = {
    name: DeploymentProviderName;
    deploy(input: DeploymentProviderDeployInput): Promise<DeploymentProviderDeployResult | void>;
    assertRollbackTarget(artifactRef: string): Promise<void>;
    cleanupDeploymentArtifact?(artifactRef: string): Promise<void>;
};
export type WfpDeploymentProviderEnv = {
    CF_ACCOUNT_ID?: string;
    CF_API_TOKEN?: string;
    WFP_DISPATCH_NAMESPACE?: string;
};
type OciDeploymentOrchestratorConfig = {
    orchestratorUrl?: string;
    orchestratorToken?: string;
    fetchImpl?: typeof fetch;
};
type DeploymentProviderFactoryConfig = OciDeploymentOrchestratorConfig & {
    cloudflareEnv?: WfpDeploymentProviderEnv;
};
type PersistedDeploymentContract = Pick<Deployment, 'provider_name' | 'target_json'>;
export declare function parseDeploymentTargetConfig(deployment: PersistedDeploymentContract): DeploymentTarget;
export declare function serializeDeploymentTarget(options?: {
    provider?: DeploymentProviderRef;
    target?: DeploymentTarget;
}): {
    providerName: Deployment['provider_name'];
    targetJson: string;
    providerStateJson: string;
};
export declare function createWorkersDispatchDeploymentProvider(wfp: WFPService): DeploymentProvider;
export declare function createOciDeploymentProvider(deployment: PersistedDeploymentContract, config?: OciDeploymentOrchestratorConfig): DeploymentProvider;
export declare function createDeploymentProvider(deployment: PersistedDeploymentContract, config?: DeploymentProviderFactoryConfig): DeploymentProvider;
export {};
//# sourceMappingURL=provider.d.ts.map