/**
 * Entity operations barrel export.
 *
 * All entity CRUD operations that the apply engine uses to provision
 * and manage Cloudflare (and external) resources.
 */

// Resources (D1, R2, KV, Queue, SecretRef, etc.)
export {
  createResource,
  deleteResource,
  listResources,
  type EntityResult,
  type EntityInfo,
} from './resource-ops.ts';

// Workers
export {
  deployWorker,
  deleteWorker,
  listWorkers,
  type WorkerEntityResult,
  type WorkerEntityInfo,
} from './worker-ops.ts';

// Containers
export {
  deployContainer,
  deleteContainer,
  listContainers,
  type ContainerEntityResult,
  type ContainerEntityInfo,
} from './container-ops.ts';

// Services
export {
  deployService,
  deleteService,
  listServices,
  type ServiceEntityResult,
  type ServiceEntityInfo,
} from './service-ops.ts';
