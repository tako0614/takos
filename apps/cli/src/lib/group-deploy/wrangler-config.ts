/**
 * Group Deploy — worker wrangler config generation.
 */
import type {
  ContainerWranglerConfig,
  ProvisionedResource,
  WranglerConfig,
  WorkerServiceDef,
} from './deploy-models.ts';
import { toBinding } from './cloudflare-utils.ts';
import { toPascalCase } from './container.ts';
import { DEFAULT_COMPATIBILITY_DATE } from '../constants.ts';

// ── Wrangler Config Generator ────────────────────────────────────────────────

export function generateWranglerConfig(
  service: WorkerServiceDef,
  serviceName: string,
  options: { groupName: string; env: string; namespace?: string; resources: Map<string, ProvisionedResource>; compatibilityDate?: string; manifestDir?: string },
): WranglerConfig | ContainerWranglerConfig {
  if (service.type !== 'worker' || !service.build) {
    throw new Error(`Cannot generate wrangler config for non-worker service: ${serviceName}`);
  }

  const scriptName = options.namespace
    ? `${options.groupName}-${serviceName}`
    : serviceName;

  if (service.containers && service.containers.length > 0) {
    const containerConfig: ContainerWranglerConfig = {
      name: scriptName,
      main: service.build.fromWorkflow.artifactPath,
      compatibility_date: options.compatibilityDate || DEFAULT_COMPATIBILITY_DATE,
      compatibility_flags: ['nodejs_compat'],
      durable_objects: {
        bindings: service.containers.map((c) => ({
          name: `${c.name.toUpperCase().replace(/-/g, '_')}_CONTAINER`,
          class_name: `${toPascalCase(c.name)}Container`,
        })),
      },
      containers: service.containers.map((c) => ({
        class_name: `${toPascalCase(c.name)}Container`,
        image: c.dockerfile,
        image_build_context: options.manifestDir || '.',
        instance_type: c.instanceType || 'basic',
        max_instances: c.maxInstances || 10,
      })),
      migrations: [{
        tag: 'v1',
        new_classes: service.containers.map((c) => `${toPascalCase(c.name)}Container`),
      }],
      ...(options.namespace ? { dispatch_namespace: options.namespace } : {}),
    };
    return containerConfig;
  }

  const config: WranglerConfig = {
    name: scriptName,
    main: service.build.fromWorkflow.artifactPath,
    compatibility_date: options.compatibilityDate || DEFAULT_COMPATIBILITY_DATE,
  };

  if (service.env && Object.keys(service.env).length > 0) {
    config.vars = { ...service.env };
  }

  if (service.bindings?.d1 && service.bindings.d1.length > 0) {
    config.d1_databases = service.bindings.d1.map((resourceName: string) => {
      const provisioned = options.resources.get(resourceName);
      if (!provisioned?.id) {
        throw new Error(`Resource '${resourceName}' not provisioned: missing database_id`);
      }
      return {
        binding: provisioned.binding || toBinding(resourceName),
        database_name: provisioned.name || resourceName,
        database_id: provisioned.id,
      };
    });
  }

  if (service.bindings?.r2 && service.bindings.r2.length > 0) {
    config.r2_buckets = service.bindings.r2.map((resourceName: string) => {
      const provisioned = options.resources.get(resourceName);
      return {
        binding: provisioned?.binding || toBinding(resourceName),
        bucket_name: provisioned?.name || resourceName,
      };
    });
  }

  if (service.bindings?.kv && service.bindings.kv.length > 0) {
    config.kv_namespaces = service.bindings.kv.map((resourceName: string) => {
      const provisioned = options.resources.get(resourceName);
      if (!provisioned?.id) {
        throw new Error(`Resource '${resourceName}' not provisioned: missing KV namespace id`);
      }
      return {
        binding: provisioned.binding || toBinding(resourceName),
        id: provisioned.id,
      };
    });
  }

  if (service.bindings?.services && service.bindings.services.length > 0) {
    config.services = service.bindings.services.map((target: string) => {
      const targetScript = options.namespace
        ? `${options.groupName}-${target}`
        : target;
      return { binding: toBinding(target), service: targetScript };
    });
  }

  if (service.bindings?.queues && service.bindings.queues.length > 0) {
    config.queues_producers = service.bindings.queues.map((resourceName: string) => {
      const provisioned = options.resources.get(resourceName);
      return {
        queue: provisioned?.name || resourceName,
        binding: provisioned?.binding || toBinding(resourceName),
      };
    });
  }

  if (service.bindings?.vectorize && service.bindings.vectorize.length > 0) {
    config.vectorize_indexes = service.bindings.vectorize.map((resourceName: string) => {
      const provisioned = options.resources.get(resourceName);
      return {
        index_name: provisioned?.name || resourceName,
        binding: provisioned?.binding || toBinding(resourceName),
      };
    });
  }

  if (options.namespace) {
    config.dispatch_namespace = options.namespace;
  }

  return config;
}

export function serializeWranglerToml(config: WranglerConfig): string {
  const lines: string[] = [];

  lines.push(`name = ${JSON.stringify(config.name)}`);
  lines.push(`main = ${JSON.stringify(config.main)}`);
  lines.push(`compatibility_date = ${JSON.stringify(config.compatibility_date)}`);

  if (config.dispatch_namespace) {
    lines.push(`dispatch_namespace = ${JSON.stringify(config.dispatch_namespace)}`);
  }

  if (config.vars && Object.keys(config.vars).length > 0) {
    lines.push('');
    lines.push('[vars]');
    for (const [key, value] of Object.entries(config.vars)) {
      lines.push(`${key} = ${JSON.stringify(value)}`);
    }
  }

  if (config.d1_databases) {
    for (const db of config.d1_databases) {
      lines.push('');
      lines.push('[[d1_databases]]');
      lines.push(`binding = ${JSON.stringify(db.binding)}`);
      lines.push(`database_name = ${JSON.stringify(db.database_name)}`);
      lines.push(`database_id = ${JSON.stringify(db.database_id)}`);
    }
  }

  if (config.r2_buckets) {
    for (const bucket of config.r2_buckets) {
      lines.push('');
      lines.push('[[r2_buckets]]');
      lines.push(`binding = ${JSON.stringify(bucket.binding)}`);
      lines.push(`bucket_name = ${JSON.stringify(bucket.bucket_name)}`);
    }
  }

  if (config.kv_namespaces) {
    for (const kv of config.kv_namespaces) {
      lines.push('');
      lines.push('[[kv_namespaces]]');
      lines.push(`binding = ${JSON.stringify(kv.binding)}`);
      lines.push(`id = ${JSON.stringify(kv.id)}`);
    }
  }

  if (config.services) {
    for (const svc of config.services) {
      lines.push('');
      lines.push('[[services]]');
      lines.push(`binding = ${JSON.stringify(svc.binding)}`);
      lines.push(`service = ${JSON.stringify(svc.service)}`);
    }
  }

  if (config.queues_producers) {
    for (const qp of config.queues_producers) {
      lines.push('');
      lines.push('[[queues.producers]]');
      lines.push(`queue = ${JSON.stringify(qp.queue)}`);
      lines.push(`binding = ${JSON.stringify(qp.binding)}`);
    }
  }

  if (config.vectorize_indexes) {
    for (const vi of config.vectorize_indexes) {
      lines.push('');
      lines.push('[[vectorize.indexes]]');
      lines.push(`index_name = ${JSON.stringify(vi.index_name)}`);
      lines.push(`binding = ${JSON.stringify(vi.binding)}`);
    }
  }

  lines.push('');
  return lines.join('\n');
}
