import type { AppCompute } from "../source/app-manifest-types.ts";
import {
  replaceManifestPublications,
  replaceServiceConsumes,
  resolveServiceConsumeEnvVars,
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

function normalizeEnvName(name: string): string {
  const normalized = String(name || "").trim();
  if (!normalized) {
    throw new Error("Environment variable name is required");
  }
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized)) {
    throw new Error(`Invalid environment variable name: ${normalized}`);
  }
  return normalized.toUpperCase();
}

type DesiredEnvVar = { name: string; value: string; secret: boolean };

type DesiredStateService = Pick<
  ServiceDesiredStateService,
  "replaceLocalEnvVars"
>;

export type GroupManagedDesiredStateDeps = {
  createDesiredStateService: (env: Env) => DesiredStateService;
  replaceManifestPublications: typeof replaceManifestPublications;
  replaceServiceConsumes: typeof replaceServiceConsumes;
  resolveServiceConsumeEnvVars: typeof resolveServiceConsumeEnvVars;
};

const defaultGroupManagedDesiredStateDeps: GroupManagedDesiredStateDeps = {
  createDesiredStateService: (env: Env) => new ServiceDesiredStateService(env),
  replaceManifestPublications,
  replaceServiceConsumes,
  resolveServiceConsumeEnvVars,
};

export { materializeRoutes, resolveWorkloadBaseUrl };

export async function syncGroupManagedDesiredState(
  env: Env,
  input: {
    spaceId: string;
    desiredState: GroupDesiredState;
    observedState: ObservedGroupState;
    resourceRows: unknown[];
  },
  deps: Partial<GroupManagedDesiredStateDeps> = {},
): Promise<Array<{ name: string; error: string }>> {
  const resolvedDeps: GroupManagedDesiredStateDeps = {
    ...defaultGroupManagedDesiredStateDeps,
    ...deps,
  };
  const desiredStateService = resolvedDeps.createDesiredStateService(env);
  const injectedEnv = buildInjectedEnv(input.desiredState);
  const failures: Array<{ name: string; error: string }> = [];

  await resolvedDeps.replaceManifestPublications(env, {
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
      const localEnvMap = new Map<string, DesiredEnvVar>();
      for (const [name, value] of Object.entries(injectedEnv)) {
        localEnvMap.set(normalizeEnvName(name), {
          name,
          value,
          secret: false,
        });
      }
      for (const entry of specEnv) {
        localEnvMap.set(normalizeEnvName(entry.name), {
          name: entry.name,
          value: entry.value,
          secret: entry.secret,
        });
      }

      await resolvedDeps.replaceServiceConsumes(env, {
        spaceId: input.spaceId,
        serviceId: observedWorkload.serviceId,
        serviceName: `${input.desiredState.manifest.name}:${workloadName}`,
        consumes: workloadSpec.consume,
      });

      const consumeEnvVars = await resolvedDeps
        .resolveServiceConsumeEnvVars(env, {
          spaceId: input.spaceId,
          serviceId: observedWorkload.serviceId,
        });
      for (const entry of consumeEnvVars) {
        const key = normalizeEnvName(entry.name);
        if (localEnvMap.has(key)) {
          throw new Error(
            `consume output resolves env '${key}' which already exists in compute '${workloadName}'`,
          );
        }
        localEnvMap.set(key, {
          name: entry.name,
          value: entry.value,
          secret: entry.secret,
        });
      }

      await desiredStateService.replaceLocalEnvVars({
        spaceId: input.spaceId,
        serviceId: observedWorkload.serviceId,
        variables: Array.from(localEnvMap.values()),
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
