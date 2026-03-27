import type { CloudRunPlatformDeployProviderConfig } from '../../platform/types.ts';

// Cloud Run deployments are handled via the OCI orchestrator abstraction layer.
// The createDeploymentProvider() factory in provider.ts routes 'cloud-run' to the
// OCI provider which communicates with the oci-orchestrator HTTP API.
// The orchestrator is responsible for translating deploy requests into
// Cloud Run-specific operations (revision creation, traffic routing, etc.).

export type CloudRunDeploymentConfig = CloudRunPlatformDeployProviderConfig['config'];
