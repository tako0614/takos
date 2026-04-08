import type {
  AppCompute,
  AppStorage,
} from '../source/app-manifest-types.ts';
import type { EntityInfo } from '../entities/resource-ops.ts';
import { ServiceDesiredStateService } from '../platform/worker-desired-state.ts';
import type { Env } from '../../../shared/types/env.ts';
import { getPortableSecretValue } from '../resources/portable-runtime.ts';
import {
  type GroupDesiredState,
  materializeRoutes,
  type ObservedGroupState,
  resolveRouteOwner,
  resolveWorkloadBaseUrl,
} from './group-state.ts';

type DesiredBindingInput = {
  name: string;
  type: string;
  resourceId: string;
  config?: Record<string, unknown>;
};

function buildBindingConfig(resourceName: string, resource: AppStorage): Record<string, unknown> | undefined {
  switch (resource.type) {
    case 'workflow': {
      const workflow = resource.workflow;
      if (!workflow) return undefined;
      return {
        workflow_name: resourceName,
        class_name: workflow.class,
        script_name: workflow.script,
      };
    }
    case 'durable-object': {
      const durableObject = resource.durableObject;
      if (!durableObject) return undefined;
      return {
        class_name: durableObject.class,
        script_name: durableObject.script,
      };
    }
    default:
      return undefined;
  }
}

/**
 * In the flat schema, compute entries do not carry an explicit `bindings`
 * block; instead the deploy pipeline materializes storage bindings from the
 * full `manifest.storage` map. Every workload that is not an attached
 * container receives every storage binding until the new wiring model
 * (explicit compute→storage declarations) lands.
 */
function buildServiceBindings(
  desiredState: GroupDesiredState,
  workloadName: string,
  resourceRows: Map<string, EntityInfo>,
): DesiredBindingInput[] {
  const workload = desiredState.workloads[workloadName];
  if (!workload) return [];
  if (workload.spec.kind === 'attached-container') return [];

  const manifestStorage = desiredState.manifest.storage ?? {};
  const result: DesiredBindingInput[] = [];
  for (const [resourceName, resource] of Object.entries(manifestStorage)) {
    const resourceEntity = resourceRows.get(resourceName);
    const desiredResource = desiredState.resources[resourceName];
    if (!resourceEntity || !desiredResource) continue;

    const config = buildBindingConfig(resourceName, resource);
    result.push({
      name: resourceEntity.config.bindingName ?? resourceEntity.config.binding,
      type: desiredResource.type,
      resourceId: resourceEntity.id,
      ...(config ? { config } : {}),
    });
  }
  return result;
}

async function buildSecretEnv(resourceRows: Map<string, EntityInfo>): Promise<Array<{ name: string; value: string; secret: boolean }>> {
  const secretEnv: Array<{ name: string; value: string; secret: boolean }> = [];
  for (const resource of resourceRows.values()) {
    const resourceClass = resource.config.resourceClass
      ?? (resource.config.type === 'secret' ? 'secret' : null);
    if (resourceClass !== 'secret') continue;

    const value = resource.providerName && resource.providerName !== 'cloudflare'
      ? await getPortableSecretValue({
          id: resource.id,
          provider_name: resource.providerName,
          provider_resource_id: resource.providerResourceId,
          provider_resource_name: resource.providerResourceName,
          config: resource.config,
        })
      : resource.providerResourceId ?? resource.id;
    secretEnv.push({
      name: resource.config.bindingName ?? resource.config.binding,
      value,
      secret: true,
    });
  }
  return secretEnv;
}

/**
 * Build the environment injected into each compute.
 *
 * In the flat schema, top-level `manifest.env` is a plain
 * `Record<string, string>` — template interpolation (`${routes.foo.url}`,
 * `${services.bar.port}`, …) was retired during Phase 1, so there is no
 * longer a `templates` pass here. The env map is returned as-is.
 */
function buildInjectedEnv(
  desiredState: GroupDesiredState,
  _observedState: ObservedGroupState,
  _resourceRows: Map<string, EntityInfo>,
): Record<string, string> {
  return desiredState.manifest.env ?? {};
}

function buildManagedMcpServerConfig(
  desiredState: GroupDesiredState,
  workloadName: string,
): { enabled: boolean; name: string; path: string } | undefined {
  const workload = desiredState.workloads[workloadName];
  if (!workload) return undefined;

  const publications = desiredState.manifest.publish ?? [];
  const routes = desiredState.manifest.routes ?? [];
  for (const publication of publications) {
    if (publication.type !== 'McpServer') continue;

    // The publication `path` is the HTTP path it is served at — match it
    // against the route table to find the owning compute.
    const matchingRoute = routes.find((route) => route.path === publication.path);
    if (!matchingRoute) continue;

    // The owning workload is the route target; route.target is the canonical
    // compute name.
    const owner = resolveRouteOwner({
      name: matchingRoute.target,
      target: matchingRoute.target,
      path: matchingRoute.path,
    });
    if (owner !== workloadName) continue;

    return {
      enabled: true,
      name: publication.name ?? publication.type,
      path: publication.path,
    };
  }

  return undefined;
}

// Expose helpers so nothing complains about unused imports in the meantime.
export { materializeRoutes, resolveWorkloadBaseUrl };

export async function syncGroupManagedDesiredState(
  env: Env,
  input: {
    spaceId: string;
    desiredState: GroupDesiredState;
    observedState: ObservedGroupState;
    resourceRows: EntityInfo[];
  },
): Promise<Array<{ name: string; error: string }>> {
  const desiredStateService = new ServiceDesiredStateService(env);
  const resourceMap = new Map(input.resourceRows.map((resource) => [resource.name, resource]));
  const injectedEnv = buildInjectedEnv(input.desiredState, input.observedState, resourceMap);
  const sharedSecrets = await buildSecretEnv(resourceMap);
  const failures: Array<{ name: string; error: string }> = [];

  for (const [workloadName, desiredWorkload] of Object.entries(input.desiredState.workloads)) {
    const observedWorkload = input.observedState.workloads[workloadName];
    if (!observedWorkload) continue;

    try {
      const workloadSpec: AppCompute = desiredWorkload.spec;
      const specEnv = workloadSpec.env
        ? Object.entries(workloadSpec.env).map(([name, value]) => ({
            name,
            value,
            secret: false,
          }))
        : [];
      const localEnvMap = new Map<string, { value: string; secret: boolean }>();
      for (const [name, value] of Object.entries(injectedEnv)) {
        localEnvMap.set(name, { value, secret: false });
      }
      for (const secret of sharedSecrets) {
        localEnvMap.set(secret.name, { value: secret.value, secret: true });
      }
      for (const entry of specEnv) {
        localEnvMap.set(entry.name, { value: entry.value, secret: entry.secret });
      }

      await desiredStateService.replaceLocalEnvVars({
        spaceId: input.spaceId,
        serviceId: observedWorkload.serviceId,
        variables: Array.from(localEnvMap.entries()).map(([name, value]) => ({
          name,
          value: value.value,
          secret: value.secret,
        })),
      });

      await desiredStateService.replaceResourceBindings({
        serviceId: observedWorkload.serviceId,
        bindings: buildServiceBindings(input.desiredState, workloadName, resourceMap) as Parameters<typeof desiredStateService.replaceResourceBindings>[0]['bindings'],
      });

      await desiredStateService.saveRuntimeConfig({
        spaceId: input.spaceId,
        serviceId: observedWorkload.serviceId,
        mcpServer: buildManagedMcpServerConfig(input.desiredState, workloadName),
      });
    } catch (error) {
      failures.push({
        name: workloadName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return failures;
}
