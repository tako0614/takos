import {
  resolveResourceDriver,
  resolveResourceImplementation,
  toResourceCapability,
} from '../resources/capabilities.ts';
import { describePortableResourceResolution } from '../resources/portable-runtime.ts';
import type { AppCompute } from '../source/app-manifest-types.ts';
import type { GroupDesiredState, GroupWorkloadCategory } from './group-state.ts';

export type GroupProviderTarget = 'cloudflare' | 'local' | 'aws' | 'gcp' | 'k8s';
type WorkloadProvider = 'oci' | 'ecs' | 'cloud-run' | 'k8s';
/**
 * Subset of the flat `AppCompute` type accessed by the translation
 * reporter. The only field we read is `image`; the previous envelope
 * shape exposed an `artifact` / `provider` block which the flat schema
 * retired.
 */
type WorkloadProviderSpec = Partial<Pick<AppCompute, 'image'>>;
export type TranslationStatus = 'native' | 'portable' | 'unsupported';
export type TranslationResolutionMode = 'cloudflare-native' | 'provider-backed' | 'takos-runtime' | 'unsupported';

export interface ResourceTranslationEntry {
  name: string;
  publicType: string;
  semanticType: string | null;
  implementation: string | null;
  driver: string;
  provider: string;
  status: TranslationStatus;
  resolutionMode: TranslationResolutionMode;
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

export type TranslationContext = {
  ociOrchestratorUrl?: string;
};

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

function trimString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getContainerImageRef(spec: WorkloadProviderSpec): string | undefined {
  return trimString(spec.image);
}

function getContainerProvider(_spec: WorkloadProviderSpec, fallback: WorkloadProvider): WorkloadProvider {
  // The flat schema no longer carries an explicit per-workload provider
  // override on the compute entry — fall back to the group-level default.
  return fallback;
}

function fallbackContainerProvider(provider: GroupProviderTarget): WorkloadProvider {
  switch (provider) {
    case 'cloudflare':
    case 'local':
      return 'oci';
    case 'aws':
      return 'ecs';
    case 'gcp':
      return 'cloud-run';
    case 'k8s':
      return 'k8s';
    default:
      return 'oci';
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
      resolutionMode: 'unsupported',
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
      resolutionMode: 'cloudflare-native',
      requirements: ['CF_ACCOUNT_ID', 'CF_API_TOKEN'],
      notes: ['Takos runtime realizes this Cloudflare-native resource directly on the Cloudflare backend.'],
    };
  }

  const resolution = describePortableResourceResolution(provider, semanticType);
  if (!resolution) {
    return {
      name,
      publicType,
      semanticType,
      implementation,
      driver: 'unknown',
      provider,
      status: 'unsupported',
      resolutionMode: 'unsupported',
      requirements: [],
      notes: [`Unsupported resource type: ${publicType}`],
    };
  }

  const notes = resolution.notes ? [...resolution.notes] : [];
  if (resolution.mode === 'provider-backed') {
    notes.push(`Takos runtime on ${provider} realizes this Cloudflare-native resource through a provider-backed adapter.`);
  } else {
    notes.push(`Takos runtime on ${provider} realizes this Cloudflare-native resource through the compatibility runtime.`);
  }
  return {
    name,
    publicType,
    semanticType,
    implementation,
    driver: resolveResourceDriver(semanticType, provider) ?? 'unknown',
    provider: resolution.mode === 'provider-backed' ? `${provider}-backing-service` : 'takos-runtime',
    status: 'portable',
    resolutionMode: resolution.mode,
    requirements: resolution.requirements,
    notes,
  };
}

function translateWorkload(
  provider: GroupProviderTarget,
  name: string,
  category: GroupWorkloadCategory,
  spec: WorkloadProviderSpec = {},
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
        notes: ['Takos runtime realizes worker workloads directly on the Cloudflare backend.'],
      };
    }

    if (provider === 'local') {
      return {
        name,
        category,
        provider: 'takos-runtime',
        runtime: 'workers',
        runtimeProfile: 'workers',
        status: 'portable',
        requirements: ['compatibility-runtime'],
        notes: ['Takos runtime on local realizes worker workloads through the compatibility runtime layer.'],
      };
    }

    return {
      name,
      category,
      provider: 'takos-runtime',
      runtime: 'workers',
      runtimeProfile: 'workers',
      status: 'portable',
      requirements: ['compatibility-runtime adapter'],
      notes: [`Takos runtime on ${provider} realizes worker workloads through the compatibility runtime layer.`],
    };
  }

  if (provider === 'cloudflare') {
    const workloadProvider = getContainerProvider(spec, fallbackContainerProvider(provider));
    const imageRef = getContainerImageRef(spec);
    const requirements = imageRef ? ['OCI_ORCHESTRATOR_URL'] : [];

    return {
      name,
      category,
      provider: workloadProvider,
      runtime: 'container-service',
      runtimeProfile: 'container-service',
      status: 'portable',
      requirements,
      notes: ['Takos runtime on the Cloudflare backend uses the OCI deployment adapter for service/container workloads.'],
    };
  }

  if (provider === 'local') {
    const workloadProvider = getContainerProvider(spec, fallbackContainerProvider(provider));
    const imageRef = getContainerImageRef(spec);
    const requirements = imageRef ? ['OCI_ORCHESTRATOR_URL'] : [];

    return {
      name,
      category,
      provider: workloadProvider,
      runtime: 'container-service',
      runtimeProfile: 'container-service',
      status: 'portable',
      requirements,
      notes: ['Takos runtime on local realizes OCI workloads through the local OCI deployment adapter.'],
    };
  }

  const workloadProvider = getContainerProvider(spec, fallbackContainerProvider(provider));
  const imageRef = getContainerImageRef(spec);
  const requirements = imageRef ? ['OCI_ORCHESTRATOR_URL'] : [];

  return {
    name,
    category,
    provider: workloadProvider,
    runtime: 'container-service',
    runtimeProfile: 'container-service',
    status: 'portable',
    requirements,
    notes: [`Takos runtime on ${provider} realizes service execution through the OCI deployment adapter.`],
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
      notes: ['Takos runtime realizes routing directly through the Cloudflare hostname routing backend.'],
    };
  }

  if (provider === 'local') {
    return {
      name,
      target,
      adapter: 'compatibility-runtime-routing',
      provider: 'compatibility-runtime-routing',
      status: 'portable',
      requirements: ['compatibility-runtime'],
      notes: ['Takos runtime on local materializes routes through compatibility runtime/local routing adapters.'],
    };
  }

  return {
    name,
    target,
    adapter: 'ingress-routing',
    provider: 'ingress-routing',
    status: 'portable',
    requirements: ['provider ingress adapter', 'HOSTNAME_ROUTING store'],
    notes: [`Takos runtime on ${provider} realizes routing through Takos-managed hostname routing plus provider ingress.`],
  };
}

export function buildTranslationReport(desiredState: GroupDesiredState, context: TranslationContext = {}): TranslationReport {
  const provider = normalizeProvider(desiredState.provider);
  const resources = Object.entries(desiredState.resources).map(([name, resource]) =>
    translateResource(provider, name, resource.type),
  );
  const workloads = Object.entries(desiredState.workloads).map(([name, workload]) =>
    translateWorkload(provider, name, workload.category, workload.spec),
  );
  const routes = Object.entries(desiredState.routes).map(([name, route]) =>
    translateRoute(provider, name, route.target),
  );

  const unsupported: TranslationIssue[] = [
    ...resources
      .filter((entry) => entry.status === 'unsupported')
      .map((entry) => ({
        category: 'resource' as const,
        name: entry.name,
        message: `${entry.publicType} resolves to ${entry.driver} (${entry.status}) on provider ${provider}`,
      })),
    ...workloads
      .filter((entry) => entry.status === 'unsupported')
      .map((entry) => ({
        category: 'workload' as const,
        name: entry.name,
        message: `${entry.category} resolves to ${entry.provider} (${entry.status}) on provider ${provider}`,
      })),
    ...routes
      .filter((entry) => entry.status === 'unsupported')
      .map((entry) => ({
        category: 'route' as const,
        name: entry.name,
        message: `${entry.target} resolves to ${entry.adapter} (${entry.status}) on provider ${provider}`,
      })),
  ];

  const requirements = uniqueRequirements([...resources, ...workloads, ...routes]);
  const hasMissingOciOrchestrator = requirements.includes('OCI_ORCHESTRATOR_URL')
    && !context.ociOrchestratorUrl?.trim();

  return {
    provider,
    supported: unsupported.length === 0 && !hasMissingOciOrchestrator,
    requirements: requirements,
    resources,
    workloads,
    routes,
    unsupported,
  };
}

export function assertTranslationSupported(report: TranslationReport, context: TranslationContext = {}): void {
  const isMissingOciOrchestrator = !context.ociOrchestratorUrl?.trim() && report.requirements.includes('OCI_ORCHESTRATOR_URL');
  if (report.unsupported.length === 0 && !isMissingOciOrchestrator) return;

  const missingRequirements: string[] = [];
  if (isMissingOciOrchestrator) {
    missingRequirements.push('OCI_ORCHESTRATOR_URL');
  }

  const details = [
    ...missingRequirements.map((entry) => `${entry} is required`),
    ...report.unsupported
      .map((issue) => `${issue.category}:${issue.name}: ${issue.message}`),
  ].join('; ');

  throw new Error(`Provider translation is not supported for "${report.provider}": ${details}`);
}
