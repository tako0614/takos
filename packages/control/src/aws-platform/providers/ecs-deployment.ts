import type { EcsPlatformDeployProviderConfig } from '../../platform/types.ts';

// Placeholder for ECS deployment provider implementation.
// Full implementation would use @aws-sdk/client-ecs to:
// 1. Register new task definition revision
// 2. Update ECS service to use new task definition
// 3. Wait for deployment to stabilize

export type EcsDeploymentConfig = EcsPlatformDeployProviderConfig['config'];
