import {
  resolveResourceDriver,
  resolveResourceImplementation,
  toResourceCapability,
} from '../resources/capabilities.ts';
import type { GroupDesiredState, GroupWorkloadCategory } from './group-state.ts';

export type GroupProviderTarget = 'cloudflare' | 'local' | 'aws' | 'gcp' | 'k8s';
export type TranslationStatus = 'native' | 'portable' | 'planned' | 'unsupported';

export interface ResourceTranslationEntry {
  name: string;
  publicType: string;
  semanticType: string | null;
  implementation: string | null;
  driver: string;
  provider: string;
  status: TranslationStatus;
  requirements: string[];
  notes?: string[];
}

export interface WorkloadTranslationEntry {
  name: string;
  category: GroupWorkloadCategory;
  provider: string;
  runtime: 'workers' | 'container-service';
  runtimeProfile: 'workers' | 'container-service';
  status: TranslationStatus;
  requirements: string[];
  notes?: string[];
}

export interface RouteTranslationEntry {
  name: string;
  target: string;
  adapter: string;
  provider: string;
  status: TranslationStatus;
  requirements: string[];
  notes?: string[];
}

export interface TranslationIssue {
  category: 'resource' | 'workload' | 'route';
  name: string;
  message: string;
}

export interface TranslationReport {
  provider: GroupProviderTarget;
  supported: boolean;
  requirements: string[];
  resources: ResourceTranslationEntry[];
  workloads: WorkloadTranslationEntry[];
  routes: RouteTranslationEntry[];
  unsupported: TranslationIssue[];
}

function normalizeProvider(provider?: string | null): GroupProviderTarget {
  switch (provider) {
    case 'local':
    case 'aws':
    case 'gcp':
    case 'k8s':
      return provider;
    case 'cloudflare':
    default:
      return 'cloudflare';
  }
}

function uniqueRequirements(entries: Array<{ requirements: string[] }>): string[] {
  return Array.from(new Set(entries.flatMap((entry) => entry.requirements))).sort();
}

function portabilityDriver(provider: GroupProviderTarget, semanticType: string | null): string {
  if (!semanticType) return 'unknown';
  switch (provider) {
    case 'local':
      switch (semanticType) {
        case 'sql':
          return 'takos-local-sql';
        case 'object_store':
          return 'takos-local-object-store';
        case 'vector_index':
          return 'takos-local-vector-index';
        case 'analytics_store':
          return 'takos-local-analytics-store';
        case 'workflow_runtime':
          return 'takos-local-workflow-runtime';
        case 'durable_namespace':
          return 'takos-local-durable-runtime';
        default:
          return `takos-local-${semanticType}`;
      }
    case 'aws':
      switch (semanticType) {
        case 'sql':
          return 'takos-sql';
        case 'object_store':
          return 'takos-object-store';
        case 'vector_index':
          return 'takos-vector-store';
        case 'analytics_store':
          return 'takos-analytics-store';
        case 'workflow_runtime':
          return 'takos-workflow-runtime';
        case 'durable_namespace':
          return 'takos-durable-runtime';
        default:
          return `takos-aws-${semanticType}`;
      }
    case 'gcp':
      switch (semanticType) {
        case 'sql':
          return 'takos-sql';
        case 'object_store':
          return 'takos-object-store';
        case 'vector_index':
          return 'takos-vector-store';
        case 'analytics_store':
          return 'takos-analytics-store';
        case 'workflow_runtime':
          return 'takos-workflow-runtime';
        case 'durable_namespace':
          return 'takos-durable-runtime';
        default:
          return `takos-gcp-${semanticType}`;
      }
    case 'k8s':
      switch (semanticType) {
        case 'sql':
          return 'takos-sql';
        case 'object_store':
          return 'takos-object-store';
        case 'vector_index':
          return 'takos-vector-store';
        case 'analytics_store':
          return 'takos-analytics-store';
        case 'workflow_runtime':
          return 'takos-workflow-runtime';
        case 'durable_namespace':
          return 'takos-durable-runtime';
        default:
          return `takos-k8s-${semanticType}`;
      }
    default:
      return 'unknown';
  }
}

function translateResource(
  provider: GroupProviderTarget,
  name: string,
  publicType: string,
): ResourceTranslationEntry {
  const semanticType = toResourceCapability(publicType);
  const implementation = semanticType ? resolveResourceImplementation(semanticType) : null;

  if (!semanticType || !implementation) {
    return {
      name,
      publicType,
      semanticType,
      implementation,
      driver: 'unknown',
      provider,
      status: 'unsupported',
      requirements: [],
      notes: [`Unsupported resource type: ${publicType}`],
    };
  }

  if (provider === 'cloudflare') {
    return {
      name,
      publicType,
      semanticType,
      implementation,
      driver: resolveResourceDriver(semanticType, 'cloudflare') ?? `cloudflare-${implementation}`,
      provider: 'cloudflare-native',
      status: 'native',
      requirements: ['CF_ACCOUNT_ID', 'CF_API_TOKEN'],
    };
  }

  if (provider === 'local') {
    const requirements: string[] = [];
    const notes: string[] = ['local resolves Cloudflare-native resources through the local portability adapters.'];
    let status: TranslationStatus = 'portable';

    if (publicType === 'vectorize') {
      requirements.push('POSTGRES_URL', 'PGVECTOR_ENABLED=true');
    }
    if (publicType === 'analyticsEngine') {
      status = 'unsupported';
      notes.push('analyticsEngine does not yet have a local portability backend.');
    }

    return {
      name,
      publicType,
      semanticType,
      implementation,
      driver: portabilityDriver(provider, semanticType),
      provider: 'local-portability-backend',
      status,
      requirements,
      notes,
    };
  }

  return {
    name,
    publicType,
    semanticType,
    implementation,
    driver: portabilityDriver(provider, semanticType),
    provider: `${provider}-portability-backend`,
    status: 'portable',
    requirements: [
      'runtime-host adapter',
      provider === 'aws'
        ? 'postgres/s3/dynamodb/sqs portability backends'
        : provider === 'gcp'
          ? 'postgres/gcs/firestore/pubsub portability backends'
          : 'postgres/minio/redis/nats portability backends',
    ],
    notes: [`${provider} resolves resources through the self-hosted portability backend family.`],
  };
}

function translateWorkload(
  provider: GroupProviderTarget,
  name: string,
  category: GroupWorkloadCategory,
): WorkloadTranslationEntry {
  if (category === 'worker') {
    if (provider === 'cloudflare') {
      return {
        name,
        category,
        provider: 'workers-dispatch',
        runtime: 'workers',
        runtimeProfile: 'workers',
        status: 'native',
        requirements: ['CF_ACCOUNT_ID', 'CF_API_TOKEN', 'WFP_DISPATCH_NAMESPACE'],
      };
    }

    if (provider === 'local') {
      return {
        name,
        category,
        provider: 'runtime-host',
        runtime: 'workers',
        runtimeProfile: 'workers',
        status: 'portable',
        requirements: ['runtime-host'],
        notes: ['local resolves workers through the runtime-host compatibility layer.'],
      };
    }

    return {
      name,
      category,
      provider: 'runtime-host',
      runtime: 'workers',
      runtimeProfile: 'workers',
      status: 'portable',
      requirements: ['runtime-host adapter'],
      notes: [`${provider} workers resolve through the runtime-host compatibility layer.`],
    };
  }

  if (provider === 'cloudflare') {
    return {
      name,
      category,
      provider: 'oci',
      runtime: 'container-service',
      runtimeProfile: 'container-service',
      status: 'portable',
      requirements: ['OCI_ORCHESTRATOR_URL'],
      notes: ['Cloudflare uses an external OCI orchestrator for service/container workloads.'],
    };
  }

  if (provider === 'local') {
    return {
      name,
      category,
      provider: 'oci',
      runtime: 'container-service',
      runtimeProfile: 'container-service',
      status: 'portable',
      requirements: ['OCI_ORCHESTRATOR_URL'],
      notes: ['local routes OCI workloads through the local OCI orchestrator.'],
    };
  }

  return {
    name,
    category,
    provider: provider === 'aws' ? 'ecs' : provider === 'gcp' ? 'cloud-run' : 'k8s',
    runtime: 'container-service',
    runtimeProfile: 'container-service',
    status: 'portable',
    requirements: ['OCI_ORCHESTRATOR_URL'],
    notes: [`${provider} service execution resolves through the OCI orchestrator adapter.`],
  };
}

function translateRoute(
  provider: GroupProviderTarget,
  name: string,
  target: string,
): RouteTranslationEntry {
  if (provider === 'cloudflare') {
    return {
      name,
      target,
      adapter: 'hostname-routing',
      provider: 'hostname-routing',
      status: 'native',
      requirements: ['HOSTNAME_ROUTING'],
    };
  }

  if (provider === 'local') {
    return {
      name,
      target,
      adapter: 'runtime-host-routing',
      provider: 'runtime-host-routing',
      status: 'portable',
      requirements: ['runtime-host'],
      notes: ['local materializes routes through runtime-host/local routing adapters.'],
    };
  }

  return {
    name,
    target,
    adapter: 'ingress-routing',
    provider: 'ingress-routing',
    status: 'portable',
    requirements: ['provider ingress adapter', 'HOSTNAME_ROUTING store'],
    notes: [`${provider} routing resolves through Takos-managed hostname routing plus provider ingress.`],
  };
}

export function buildTranslationReport(desiredState: GroupDesiredState): TranslationReport {
  const provider = normalizeProvider(desiredState.provider);
  const resources = Object.entries(desiredState.resources).map(([name, resource]) =>
    translateResource(provider, name, resource.type),
  );
  const workloads = Object.entries(desiredState.workloads).map(([name, workload]) =>
    translateWorkload(provider, name, workload.category),
  );
  const routes = Object.entries(desiredState.routes).map(([name, route]) =>
    translateRoute(provider, name, route.target),
  );

  const unsupported: TranslationIssue[] = [
    ...resources
      .filter((entry) => entry.status === 'planned' || entry.status === 'unsupported')
      .map((entry) => ({
        category: 'resource' as const,
        name: entry.name,
        message: `${entry.publicType} resolves to ${entry.driver} (${entry.status}) on provider ${provider}`,
      })),
    ...workloads
      .filter((entry) => entry.status === 'planned' || entry.status === 'unsupported')
      .map((entry) => ({
        category: 'workload' as const,
        name: entry.name,
        message: `${entry.category} resolves to ${entry.provider} (${entry.status}) on provider ${provider}`,
      })),
    ...routes
      .filter((entry) => entry.status === 'planned' || entry.status === 'unsupported')
      .map((entry) => ({
        category: 'route' as const,
        name: entry.name,
        message: `${entry.target} resolves to ${entry.adapter} (${entry.status}) on provider ${provider}`,
      })),
  ];

  return {
    provider,
    supported: unsupported.length === 0,
    requirements: uniqueRequirements([...resources, ...workloads, ...routes]),
    resources,
    workloads,
    routes,
    unsupported,
  };
}

export function assertTranslationSupported(report: TranslationReport): void {
  if (report.supported) return;

  const details = report.unsupported
    .map((issue) => `${issue.category}:${issue.name}: ${issue.message}`)
    .join('; ');

  throw new Error(`Provider translation is not supported for "${report.provider}": ${details}`);
}
