/**
 * Provider exports.
 *
 * Re-exports all cloud / platform providers, the ResourceProvider interface,
 * and the resolveProvider helper from the canonical group-deploy module.
 *
 * The actual implementations live in `../group-deploy/providers/`.
 * This barrel exists only for backward-compatible import paths.
 */
export { CloudflareProvider, AWSProvider, GCPProvider, K8sProvider, DockerProvider } from '../group-deploy/providers/index.js';
export type { ResourceProvider, ProvisionResult, ProviderOptions } from '../group-deploy/resource-provider.js';
export { resolveProvider } from '../group-deploy/provisioner.js';
