/**
 * Entity Layer (Layer 1) — barrel export.
 *
 * Independent entity operations for Worker, Resource, Container, and Service.
 * Each entity can be created, listed, and deleted without requiring a full
 * app.yml manifest.
 */

// ── Resource ─────────────────────────────────────────────────────────────────
export type { CreateResourceOpts, ResourceType, ResourceEntry } from './resource.js';
export { createResource, listResources, deleteResource } from './resource.js';

// ── Worker ───────────────────────────────────────────────────────────────────
export type { DeployWorkerOpts, WorkerEntry } from './worker.js';
export { deployWorker, listWorkers, deleteWorker } from './worker.js';

// ── Container ────────────────────────────────────────────────────────────────
export type { DeployContainerOpts, ContainerEntry } from './container.js';
export { deployContainer, listContainers, deleteContainer } from './container.js';

// ── Service ──────────────────────────────────────────────────────────────────
export type { DeployServiceOpts, ServiceEntry } from './service.js';
export { deployService, listServices, deleteService } from './service.js';
