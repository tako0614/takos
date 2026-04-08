/**
 * Wrangler Config Generator for group deploy.
 *
 * Generates wrangler.toml-equivalent configuration objects from an app.yml
 * worker compute entry plus provisioned resources. The output can be
 * serialized to TOML for wrangler deploy, or used directly with the
 * Cloudflare API.
 *
 * Phase 2: rewritten against the flat-schema `AppCompute` type. In the flat
 * schema, workers no longer carry explicit `bindings` arrays — the deploy
 * pipeline materializes every declared `storage` entry as a binding on the
 * worker. `generateWranglerConfig` therefore takes the full
 * `provisioned` map and emits a binding per entry keyed by its canonical
 * storage type.
 */
import type { AppCompute } from "../source/app-manifest-types.ts";
import type {
  ProvisionedResource,
  WranglerConfig,
  WranglerD1Binding,
  WranglerKVBinding,
  WranglerQueueProducer,
  WranglerR2Binding,
  WranglerServiceBinding,
  WranglerVectorizeIndex,
} from "./group-deploy-types.ts";

export interface GenerateWranglerConfigOptions {
  groupName: string;
  env: string;
  namespace?: string;
  resources: Map<string, ProvisionedResource>;
  compatibilityDate?: string;
}

function defaultBindingName(resourceName: string): string {
  return resourceName.toUpperCase().replace(/-/g, "_");
}

/**
 * Build a wrangler config object for a single worker compute entry.
 *
 * The script name is scoped to the group when deploying inside a dispatch
 * namespace, or left plain when deploying account-level.
 */
export function generateWranglerConfig(
  compute: AppCompute,
  serviceName: string,
  options: GenerateWranglerConfigOptions,
): WranglerConfig {
  const scriptName = options.namespace
    ? `${options.groupName}-${serviceName}`
    : serviceName;

  const main = compute.build?.fromWorkflow.artifactPath ?? "dist/worker.js";

  const config: WranglerConfig = {
    name: scriptName,
    main,
    compatibility_date: options.compatibilityDate || "2026-04-01",
  };

  if (compute.env && Object.keys(compute.env).length > 0) {
    config.vars = { ...compute.env };
  }

  const d1Bindings: WranglerD1Binding[] = [];
  const r2Bindings: WranglerR2Binding[] = [];
  const kvBindings: WranglerKVBinding[] = [];
  const queueProducers: WranglerQueueProducer[] = [];
  const vectorizeBindings: WranglerVectorizeIndex[] = [];
  // Service binding wiring is managed separately by the kernel in the flat
  // schema; generateWranglerConfig does not emit service bindings anymore.
  const serviceBindings: WranglerServiceBinding[] = [];

  for (const [resourceName, provisioned] of options.resources.entries()) {
    const binding = provisioned.binding || defaultBindingName(resourceName);
    switch (provisioned.type) {
      case "sql":
      case "d1": {
        if (!provisioned.id) {
          throw new Error(
            `Resource '${resourceName}' not provisioned: missing database_id`,
          );
        }
        d1Bindings.push({
          binding,
          database_name: provisioned.name || resourceName,
          database_id: provisioned.id,
        });
        break;
      }
      case "object-store":
      case "r2": {
        r2Bindings.push({
          binding,
          bucket_name: provisioned.name || resourceName,
        });
        break;
      }
      case "key-value":
      case "kv": {
        if (!provisioned.id) {
          throw new Error(
            `Resource '${resourceName}' not provisioned: missing KV namespace id`,
          );
        }
        kvBindings.push({ binding, id: provisioned.id });
        break;
      }
      case "queue": {
        queueProducers.push({
          queue: provisioned.name || resourceName,
          binding,
        });
        break;
      }
      case "vector-index":
      case "vectorize": {
        vectorizeBindings.push({
          index_name: provisioned.name || resourceName,
          binding,
        });
        break;
      }
      default:
        // Analytics / workflow / durable-object / secret are handled outside
        // the wrangler TOML (analytics engine is implicit, workflow and
        // durable-object are wired via the deploy pipeline, secrets go via
        // `wrangler secret put`).
        break;
    }
  }

  if (d1Bindings.length > 0) config.d1_databases = d1Bindings;
  if (r2Bindings.length > 0) config.r2_buckets = r2Bindings;
  if (kvBindings.length > 0) config.kv_namespaces = kvBindings;
  if (queueProducers.length > 0) config.queues_producers = queueProducers;
  if (vectorizeBindings.length > 0) config.vectorize = vectorizeBindings;
  if (serviceBindings.length > 0) config.services = serviceBindings;

  return config;
}

/**
 * Serialize a WranglerConfig to TOML string for writing to wrangler.toml.
 */
export function serializeWranglerToml(config: WranglerConfig): string {
  const lines: string[] = [];

  lines.push(`name = ${JSON.stringify(config.name)}`);
  lines.push(`main = ${JSON.stringify(config.main)}`);
  lines.push(
    `compatibility_date = ${JSON.stringify(config.compatibility_date)}`,
  );

  if (config.compatibility_flags && config.compatibility_flags.length > 0) {
    lines.push(
      `compatibility_flags = [${
        config.compatibility_flags.map((f) => JSON.stringify(f)).join(", ")
      }]`,
    );
  }

  if (config.vars && Object.keys(config.vars).length > 0) {
    lines.push("");
    lines.push("[vars]");
    for (const [key, value] of Object.entries(config.vars)) {
      lines.push(`${key} = ${JSON.stringify(value)}`);
    }
  }

  if (config.d1_databases) {
    for (const db of config.d1_databases) {
      lines.push("");
      lines.push("[[d1_databases]]");
      lines.push(`binding = ${JSON.stringify(db.binding)}`);
      lines.push(`database_name = ${JSON.stringify(db.database_name)}`);
      lines.push(`database_id = ${JSON.stringify(db.database_id)}`);
    }
  }

  if (config.r2_buckets) {
    for (const bucket of config.r2_buckets) {
      lines.push("");
      lines.push("[[r2_buckets]]");
      lines.push(`binding = ${JSON.stringify(bucket.binding)}`);
      lines.push(`bucket_name = ${JSON.stringify(bucket.bucket_name)}`);
    }
  }

  if (config.kv_namespaces) {
    for (const kv of config.kv_namespaces) {
      lines.push("");
      lines.push("[[kv_namespaces]]");
      lines.push(`binding = ${JSON.stringify(kv.binding)}`);
      lines.push(`id = ${JSON.stringify(kv.id)}`);
    }
  }

  if (config.services) {
    for (const svc of config.services) {
      lines.push("");
      lines.push("[[services]]");
      lines.push(`binding = ${JSON.stringify(svc.binding)}`);
      lines.push(`service = ${JSON.stringify(svc.service)}`);
    }
  }

  if (config.queues_producers) {
    for (const qp of config.queues_producers) {
      lines.push("");
      lines.push("[[queues.producers]]");
      lines.push(`queue = ${JSON.stringify(qp.queue)}`);
      lines.push(`binding = ${JSON.stringify(qp.binding)}`);
    }
  }

  if (config.vectorize) {
    for (const vi of config.vectorize) {
      lines.push("");
      lines.push("[[vectorize]]");
      lines.push(`index_name = ${JSON.stringify(vi.index_name)}`);
      lines.push(`binding = ${JSON.stringify(vi.binding)}`);
    }
  }

  lines.push("");
  return lines.join("\n");
}
