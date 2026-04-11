import type { AppCompute } from "../source/app-manifest-types.ts";
import {
  replaceManifestPublications,
  replaceServiceConsumes,
} from "../platform/service-publications.ts";
import { ServiceDesiredStateService } from "../platform/worker-desired-state.ts";
import type { Env } from "../../../shared/types/env.ts";
import {
  type GroupDesiredState,
  materializeRoutes,
  type ObservedGroupState,
  resolveWorkloadBaseUrl,
} from "./group-state.ts";

function buildInjectedEnv(
  desiredState: GroupDesiredState,
): Record<string, string> {
  return desiredState.manifest.env ?? {};
}

export { materializeRoutes, resolveWorkloadBaseUrl };

export async function syncGroupManagedDesiredState(
  env: Env,
  input: {
    spaceId: string;
    desiredState: GroupDesiredState;
    observedState: ObservedGroupState;
    resourceRows: unknown[];
  },
): Promise<Array<{ name: string; error: string }>> {
  const desiredStateService = new ServiceDesiredStateService(env);
  const injectedEnv = buildInjectedEnv(input.desiredState);
  const failures: Array<{ name: string; error: string }> = [];

  await replaceManifestPublications(env, {
    spaceId: input.spaceId,
    groupId: input.observedState.groupId,
    manifest: {
      publish: input.desiredState.manifest.publish,
      routes: input.desiredState.manifest.routes,
    },
    observedState: input.observedState,
  });

  for (
    const [workloadName, desiredWorkload] of Object.entries(
      input.desiredState.workloads,
    )
  ) {
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
      for (const entry of specEnv) {
        localEnvMap.set(entry.name, {
          value: entry.value,
          secret: entry.secret,
        });
      }

      await replaceServiceConsumes(env, {
        spaceId: input.spaceId,
        serviceId: observedWorkload.serviceId,
        serviceName: `${input.desiredState.manifest.name}:${workloadName}`,
        consumes: workloadSpec.consume,
      });

      await desiredStateService.replaceLocalEnvVars({
        spaceId: input.spaceId,
        serviceId: observedWorkload.serviceId,
        variables: Array.from(localEnvMap.entries()).map(([name, value]) => ({
          name,
          value: value.value,
          secret: value.secret,
        })),
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
