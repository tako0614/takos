/**
 * Entity operations barrel export.
 *
 * All entity CRUD operations that the apply engine uses to provision
 * and manage provider-backed and external resources.
 */

// Resources (SQL database, object store, kv store, message queue, SecretRef, etc.)
export {
  createResource,
  deleteResource,
  type EntityInfo,
  type EntityResult,
  listResources,
} from "./resource-ops.ts";

// Workloads
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
