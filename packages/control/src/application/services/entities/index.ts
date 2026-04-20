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
  type EntityInfo,
  type EntityResult,
  listResources,
} from "./resource-ops.ts";

// Workers
export {
  deleteWorker,
  deployWorker,
  listWorkers,
  type WorkerEntityInfo,
  type WorkerEntityResult,
} from "./worker-ops.ts";

// Containers
export {
  type ContainerEntityInfo,
  type ContainerEntityResult,
  deleteContainer,
  deployContainer,
  listContainers,
} from "./container-ops.ts";

// Services
export {
  deleteService,
  deployService,
  listServices,
  type ServiceEntityInfo,
  type ServiceEntityResult,
} from "./service-ops.ts";
