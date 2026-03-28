/**
 * Wrangler Config Generator for group deploy.
 *
 * Generates wrangler.toml-equivalent configuration objects from an app.yml
 * worker service definition plus provisioned resources. The output can be
 * serialized to TOML for wrangler deploy, or used directly with the
 * Cloudflare API.
 */
import type { WorkerService } from './group-deploy-manifest.js';
import type {
  ProvisionedResource,
  WranglerConfig,
  WranglerD1Binding,
  WranglerR2Binding,
  WranglerKVBinding,
  WranglerServiceBinding,
} from './group-deploy-types.js';

export interface GenerateWranglerConfigOptions {
  groupName: string;
  env: string;
  namespace?: string;
  resources: Map<string, ProvisionedResource>;
  compatibilityDate?: string;
}

/**
 * Build a wrangler config object for a single worker service.
 *
 * The script name is scoped to the group when deploying inside a dispatch
 * namespace, or left plain when deploying account-level.
 */
export function generateWranglerConfig(
  service: WorkerService,
  serviceName: string,
  options: GenerateWranglerConfigOptions,
): WranglerConfig {
  const scriptName = options.namespace
    ? `${options.groupName}-${serviceName}`
    : serviceName;

  const config: WranglerConfig = {
    name: scriptName,
    main: service.build.fromWorkflow.artifactPath,
    compatibility_date: options.compatibilityDate || '2025-01-01',
  };

  // Env vars
  if (service.env && Object.keys(service.env).length > 0) {
    config.vars = { ...service.env };
  }

  // D1 bindings
  if (service.bindings?.d1 && service.bindings.d1.length > 0) {
    config.d1_databases = service.bindings.d1.map((resourceName): WranglerD1Binding => {
      const provisioned = options.resources.get(resourceName);
      return {
        binding: provisioned?.binding || resourceName.toUpperCase().replace(/-/g, '_'),
        database_name: provisioned?.name || resourceName,
        database_id: provisioned?.id || 'TODO',
      };
    });
  }

  // R2 bindings
  if (service.bindings?.r2 && service.bindings.r2.length > 0) {
    config.r2_buckets = service.bindings.r2.map((resourceName): WranglerR2Binding => {
      const provisioned = options.resources.get(resourceName);
      return {
        binding: provisioned?.binding || resourceName.toUpperCase().replace(/-/g, '_'),
        bucket_name: provisioned?.name || resourceName,
      };
    });
  }

  // KV bindings
  if (service.bindings?.kv && service.bindings.kv.length > 0) {
    config.kv_namespaces = service.bindings.kv.map((resourceName): WranglerKVBinding => {
      const provisioned = options.resources.get(resourceName);
      return {
        binding: provisioned?.binding || resourceName.toUpperCase().replace(/-/g, '_'),
        id: provisioned?.id || 'TODO',
      };
    });
  }

  // Service bindings (inter-service references within the group)
  if (service.bindings?.services && service.bindings.services.length > 0) {
    config.services = service.bindings.services.map((targetServiceName): WranglerServiceBinding => {
      const targetScriptName = options.namespace
        ? `${options.groupName}-${targetServiceName}`
        : targetServiceName;
      return {
        binding: targetServiceName.toUpperCase().replace(/-/g, '_'),
        service: targetScriptName,
      };
    });
  }

  // Dispatch namespace
  if (options.namespace) {
    config.dispatch_namespace = options.namespace;
  }

  return config;
}

/**
 * Serialize a WranglerConfig to TOML string for writing to wrangler.toml.
 *
 * Uses a simple manual serializer since we only need a flat config
 * with array-of-table sections for bindings.
 */
export function serializeWranglerToml(config: WranglerConfig): string {
  const lines: string[] = [];

  lines.push(`name = ${JSON.stringify(config.name)}`);
  lines.push(`main = ${JSON.stringify(config.main)}`);
  lines.push(`compatibility_date = ${JSON.stringify(config.compatibility_date)}`);

  if (config.compatibility_flags && config.compatibility_flags.length > 0) {
    lines.push(`compatibility_flags = [${config.compatibility_flags.map(f => JSON.stringify(f)).join(', ')}]`);
  }

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

  lines.push('');
  return lines.join('\n');
}
