import { resolveTemplates } from '../source/app-manifest-template.ts';
import type { AppContainer, AppResource, AppService, AppWorker } from '../source/app-manifest-types.ts';
import { getWorkloadResourceBindingDescriptors } from '../source/app-manifest-bindings.ts';
import type { EntityInfo } from '../entities/resource-ops.ts';
import { ServiceDesiredStateService } from '../platform/worker-desired-state.ts';
import type { Env } from '../../../shared/types/env.ts';
import {
  type GroupDesiredState,
  type ObservedGroupState,
  materializeRoutes,
  resolveRouteOwner,
  resolveWorkloadBaseUrl,
} from './group-state.ts';

type DesiredBindingInput = {
  name: string;
  type: string;
  resourceId: string;
  config?: Record<string, unknown>;
};

function buildBindingConfig(resourceName: string, resource: AppResource): Record<string, unknown> | undefined {
  switch (resource.type) {
    case 'workflow':
    case 'workflow_runtime': {
      const workflow = 'workflow' in resource ? resource.workflow : resource.workflowRuntime;
      if (!workflow) return undefined;
      return {
        workflow_name: resourceName,
        class_name: workflow.export,
        script_name: workflow.service,
      };
    }
    case 'durableObject':
    case 'durable_namespace': {
      const durableNamespace = 'durableObject' in resource ? resource.durableObject : resource.durableNamespace;
      if (!durableNamespace) return undefined;
      return {
        class_name: durableNamespace.className,
        ...(durableNamespace.scriptName
          ? { script_name: durableNamespace.scriptName }
          : {}),
      };
    }
    default:
      return undefined;
  }
}

function buildServiceBindings(
  desiredState: GroupDesiredState,
  workloadName: string,
  resourceRows: Map<string, EntityInfo>,
): DesiredBindingInput[] {
  const workload = desiredState.workloads[workloadName];
  if (!workload) return [];

  const spec = workload.spec as AppWorker | AppContainer | AppService;
  const bindings = 'bindings' in spec ? spec.bindings : undefined;
  if (!bindings) return [];

  return getWorkloadResourceBindingDescriptors(bindings).flatMap(({ resourceName }) => {
    const resourceEntity = resourceRows.get(resourceName);
    const desiredResource = desiredState.resources[resourceName];
    const manifestResource = desiredState.manifest.spec.resources?.[resourceName];
    if (!resourceEntity || !desiredResource || !manifestResource) return [];

    return [{
      name: resourceEntity.config.bindingName ?? resourceEntity.config.binding,
      type: desiredResource.type,
      resourceId: resourceEntity.id,
      ...(buildBindingConfig(resourceName, manifestResource) ? { config: buildBindingConfig(resourceName, manifestResource) } : {}),
    }];
  });
}

function buildSecretEnv(resourceRows: Map<string, EntityInfo>): Array<{ name: string; value: string; secret: boolean }> {
  const secretEnv: Array<{ name: string; value: string; secret: boolean }> = [];
  for (const resource of resourceRows.values()) {
    const resourceClass = resource.config.resourceClass
      ?? (resource.config.type === 'secret' ? 'secret' : null);
    if (resourceClass !== 'secret') continue;
    secretEnv.push({
      name: resource.config.bindingName ?? resource.config.binding,
      value: resource.providerResourceId ?? resource.id,
      secret: true,
    });
  }
  return secretEnv;
}

function buildInjectedEnv(
  desiredState: GroupDesiredState,
  observedState: ObservedGroupState,
  resourceRows: Map<string, EntityInfo>,
): Record<string, string> {
  const inject = desiredState.manifest.spec.env?.inject;
  if (!inject || Object.keys(inject).length === 0) return {};

  const materializedRoutes = materializeRoutes(desiredState.routes, observedState.workloads);
  const context = {
    routes: Object.fromEntries(
      Object.entries(materializedRoutes).flatMap(([name, route]) => {
        if (!route.url) return [];
        try {
          const url = new URL(route.url);
          return [[name, { url: route.url, domain: url.hostname, path: route.path ?? url.pathname }]];
        } catch {
          return [];
        }
      }),
    ),
    containers: Object.fromEntries(
      Object.entries(desiredState.workloads)
        .filter(([, workload]) => workload.category === 'container')
        .map(([name, workload]) => [name, {
          port: (workload.spec as { port: number }).port,
        }]),
    ),
    services: Object.fromEntries(
      Object.entries(desiredState.workloads)
        .filter(([, workload]) => workload.category === 'service')
        .map(([name, workload]) => {
          const observed = observedState.workloads[name];
          return [name, {
            ...(observed?.ipv4 ? { ipv4: observed.ipv4 } : {}),
            port: (workload.spec as { port: number }).port,
          }];
        }),
    ),
    workers: Object.fromEntries(
      Object.entries(observedState.workloads)
        .filter(([, workload]) => workload.category === 'worker')
        .flatMap(([name, workload]) => {
          const url = resolveWorkloadBaseUrl(workload);
          return url ? [[name, { url }]] : [];
        }),
    ),
    resources: Object.fromEntries(
      Array.from(resourceRows.entries()).map(([name, resource]) => [name, { id: resource.providerResourceId ?? resource.id }]),
    ),
  };

  return resolveTemplates(inject, context);
}

function buildManagedMcpServerConfig(
  desiredState: GroupDesiredState,
  workloadName: string,
): { enabled: boolean; name: string; path: string } | undefined {
  const workload = desiredState.workloads[workloadName];
  if (!workload) return undefined;

  const servers = desiredState.manifest.spec.mcpServers ?? [];
  for (const server of servers) {
    if (!server.route) continue;
    const route = desiredState.routes[server.route];
    if (!route) continue;
    if (resolveRouteOwner(route) !== workloadName) continue;
    return {
      enabled: true,
      name: server.name,
      path: route.path ?? '/',
    };
  }

  return undefined;
}

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
  const sharedSecrets = buildSecretEnv(resourceMap);
  const failures: Array<{ name: string; error: string }> = [];

  for (const [workloadName, desiredWorkload] of Object.entries(input.desiredState.workloads)) {
    const observedWorkload = input.observedState.workloads[workloadName];
    if (!observedWorkload) continue;

    try {
      const specEnv = 'env' in desiredWorkload.spec && desiredWorkload.spec.env
        ? Object.entries(desiredWorkload.spec.env).map(([name, value]) => ({
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
