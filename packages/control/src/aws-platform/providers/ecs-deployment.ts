import type { EcsPlatformDeployProviderConfig } from '../../platform/types.ts';

// ECS deployments are handled via the OCI orchestrator abstraction layer.
// The createDeploymentProvider() factory in provider.ts routes 'ecs' to the
// OCI provider which communicates with the oci-orchestrator HTTP API.
// The orchestrator is responsible for translating deploy requests into
// ECS-specific operations (task definition revision, service update, etc.).

export type EcsDeploymentConfig = EcsPlatformDeployProviderConfig['config'];
