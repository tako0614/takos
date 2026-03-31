/**
 * Entity Layer (Layer 1) — barrel export.
 *
 * Independent entity operations for Worker, Resource, Container, and Service.
 * Each entity can be created, listed, and deleted without requiring a full
 * app.yml manifest.
 */

// ── Resource ─────────────────────────────────────────────────────────────────
export type { CreateResourceOpts, ResourceType, ResourceEntry } from './resource.ts';
export { createResource, listResources, deleteResource } from './resource.ts';

// ── Worker ───────────────────────────────────────────────────────────────────
export type { DeployWorkerOpts, WorkerEntry } from './worker.ts';
export { deployWorker, listWorkers, deleteWorker } from './worker.ts';

// ── Container ────────────────────────────────────────────────────────────────
export type { DeployContainerOpts, ContainerEntry } from './container.ts';
export { deployContainer, listContainers, deleteContainer } from './container.ts';

// ── Service ──────────────────────────────────────────────────────────────────
export type { DeployServiceOpts, ServiceEntry } from './service.ts';
export { deployService, listServices, deleteService } from './service.ts';
