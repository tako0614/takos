/**
 * Entry executor — dispatches a single DiffEntry to the appropriate
 * Layer 1 entity operation (resource / worker / container / service).
 */

import { createResource, deleteResource } from '../entities/resource.js';
import type { ResourceType } from '../entities/resource.js';
import { deployWorker, deleteWorker } from '../entities/worker.js';
import { deployContainer, deleteContainer } from '../entities/container.js';
import { deployService, deleteService } from '../entities/service.js';
import type { DiffEntry } from '../state/diff.js';
import type { AppManifest } from '../app-manifest.js';
import { DEFAULT_CONTAINER_PORT } from './coordinator.js';
import type { ApplyOpts } from './coordinator.js';

export async function executeEntry(
  entry: DiffEntry,
  manifest: AppManifest,
  opts: ApplyOpts,
): Promise<void> {
  const { name, category, action } = entry;
  const { resources, containers, services } = manifest.spec;

  switch (category) {
    case 'resource': {
      if (action === 'create') {
        const resource = resources?.[name];
        if (!resource) break;
        await createResource(name, { type: resource.type as ResourceType, ...opts });
      }
      if (action === 'delete') {
        await deleteResource(name, opts);
      }
      break;
    }

    case 'worker': {
      if (action === 'create' || action === 'update') {
        await deployWorker(name, { ...opts });
      }
      if (action === 'delete') {
        await deleteWorker(name, opts);
      }
      break;
    }

    case 'container': {
      if (action === 'create' || action === 'update') {
        const container = containers?.[name];
        if (!container) break;
        if (!container.dockerfile) {
          throw new Error(`spec.containers.${name}.dockerfile is required for offline apply`);
        }
        await deployContainer(name, {
          dockerfile: container.dockerfile,
          port: container.port ?? DEFAULT_CONTAINER_PORT,
          ...opts,
        });
      }
      if (action === 'delete') {
        await deleteContainer(name, opts);
      }
      break;
    }

    case 'service': {
      if (action === 'create' || action === 'update') {
        const service = services?.[name];
        if (!service) break;
        if (!service.dockerfile) {
          throw new Error(`spec.services.${name}.dockerfile is required for offline apply`);
        }
        await deployService(name, {
          dockerfile: service.dockerfile,
          port: service.port ?? DEFAULT_CONTAINER_PORT,
          ...opts,
        });
      }
      if (action === 'delete') {
        await deleteService(name, opts);
      }
      break;
    }
  }
}
