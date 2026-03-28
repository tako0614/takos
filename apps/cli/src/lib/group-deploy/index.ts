/**
 * Group Deploy — local orchestrator for CLI use.
 *
 * This is a self-contained implementation that lives alongside the CLI.
 * It mirrors the logic from packages/control/src/application/services/deployment/group-deploy.ts
 * but avoids pulling in the full control package (which depends on Cloudflare Workers
 * runtime bindings not available in a Node CLI context).
 *
 * The core functions are:
 * - deployGroup(): orchestrate a full app.yml deploy
 * - provisionResources(): create D1/R2/KV/secrets
 * - generateWranglerConfig(): build wrangler config from manifest
 */

// Re-export all types
export type {
  ServiceDeployStatus,
  ResourceProvisionStatus,
  BindingStatus,
  ServiceDeployResult,
  ResourceProvisionResult,
  BindingResult,
  GroupDeployResult,
  ContainerSpec,
  WorkerContainerSpec,
  ManifestWorkerDef,
  ManifestContainerDef,
  ManifestServiceDef,
  TemplateContext,
  GroupDeployOptions,
  WranglerDirectDeployOptions,
  WranglerDirectDeployResult,
} from './deploy-models.js';

// Re-export container helpers (exported in original)
export { toPascalCase, generateContainerWranglerConfig, serializeContainerWranglerToml, generateContainerHostEntry } from './container.js';

// Re-export template helpers (exported in original)
export { buildTemplateContext, resolveTemplateString } from './template.js';

// Re-export public API
export { deployGroup } from './orchestrator.js';
export { deployWranglerDirect } from './wrangler-direct.js';
