import type { AppCompute, AppConsume } from "../source/app-manifest-types.ts";
import {
  listServiceConsumes,
  previewServiceConsumeEnvVars,
  replaceManifestPublications,
  replaceServiceConsumes,
  resolveServiceConsumeEnvVars,
} from "../platform/service-publications.ts";
import { ServiceDesiredStateService } from "../platform/worker-desired-state.ts";
import { resolveLinkedCommonEnvState } from "../platform/env-state-resolution.ts";
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
  "listLocalEnvVars" | "replaceLocalEnvVars"
>;

export type ManagedWorkloadDesiredStateSnapshot = {
  spaceId: string;
  serviceId: string;
  serviceName: string;
  consumes: AppConsume[];
  localEnvVars: Array<{ name: string; value: string; secret: boolean }>;
};

export type GroupManagedDesiredStateDeps = {
  createDesiredStateService: (env: Env) => DesiredStateService;
  previewServiceConsumeEnvVars: typeof previewServiceConsumeEnvVars;
  replaceManifestPublications: typeof replaceManifestPublications;
  replaceServiceConsumes: typeof replaceServiceConsumes;
  resolveServiceConsumeEnvVars: typeof resolveServiceConsumeEnvVars;
  resolveLinkedCommonEnvState: typeof resolveLinkedCommonEnvState;
};

type ManagedWorkloadDesiredStateHelpers = {
  createDesiredStateService: (env: Env) => DesiredStateService;
  listServiceConsumes: typeof listServiceConsumes;
  replaceServiceConsumes: typeof replaceServiceConsumes;
};

const defaultGroupManagedDesiredStateDeps: GroupManagedDesiredStateDeps = {
  createDesiredStateService: (env: Env) => new ServiceDesiredStateService(env),
  previewServiceConsumeEnvVars,
  replaceManifestPublications,
  replaceServiceConsumes,
  resolveServiceConsumeEnvVars,
  resolveLinkedCommonEnvState,
};

const defaultManagedWorkloadDesiredStateHelpers:
  ManagedWorkloadDesiredStateHelpers = {
    createDesiredStateService: (env: Env) =>
      new ServiceDesiredStateService(env),
    listServiceConsumes,
    replaceServiceConsumes,
  };

export { materializeRoutes, resolveWorkloadBaseUrl };

export async function captureManagedWorkloadDesiredState(
  env: Env,
  params: {
    spaceId: string;
    serviceId: string;
    serviceName: string;
  },
  deps: Partial<ManagedWorkloadDesiredStateHelpers> = {},
): Promise<ManagedWorkloadDesiredStateSnapshot> {
  const resolvedDeps = {
    ...defaultManagedWorkloadDesiredStateHelpers,
    ...deps,
  };
  const desiredStateService = resolvedDeps.createDesiredStateService(env);
  const [consumes, localEnvVars] = await Promise.all([
    resolvedDeps.listServiceConsumes(env, params.spaceId, params.serviceId),
    desiredStateService.listLocalEnvVars(params.spaceId, params.serviceId),
  ]);

  return {
    spaceId: params.spaceId,
    serviceId: params.serviceId,
    serviceName: params.serviceName,
    consumes,
    localEnvVars: localEnvVars.map((row) => ({
      name: row.name,
      value: row.value,
      secret: row.secret,
    })),
  };
}

export async function restoreManagedWorkloadDesiredState(
  env: Env,
  snapshot: ManagedWorkloadDesiredStateSnapshot,
  deps: Partial<ManagedWorkloadDesiredStateHelpers> = {},
): Promise<void> {
  const resolvedDeps = {
    ...defaultManagedWorkloadDesiredStateHelpers,
    ...deps,
  };
  const desiredStateService = resolvedDeps.createDesiredStateService(env);
  const errors: string[] = [];

  try {
    await resolvedDeps.replaceServiceConsumes(env, {
      spaceId: snapshot.spaceId,
      serviceId: snapshot.serviceId,
      serviceName: snapshot.serviceName,
      consumes: snapshot.consumes,
    });
  } catch (error) {
    errors.push(
      error instanceof Error ? error.message : String(error),
    );
  }

  try {
    await desiredStateService.replaceLocalEnvVars({
      spaceId: snapshot.spaceId,
      serviceId: snapshot.serviceId,
      variables: snapshot.localEnvVars,
    });
  } catch (error) {
    errors.push(
      error instanceof Error ? error.message : String(error),
    );
  }

  if (errors.length > 0) {
    throw new Error(errors.join("; "));
  }
}

export async function syncGroupManagedDesiredState(
  env: Env,
  input: {
    spaceId: string;
    desiredState: GroupDesiredState;
    observedState: ObservedGroupState;
    resourceRows: unknown[];
    targetWorkloadNames?: string[];
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
  const targetWorkloadNames = input.targetWorkloadNames
    ? new Set(
      input.targetWorkloadNames.map((name) => name.trim()).filter(Boolean),
    )
    : null;

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
    if (targetWorkloadNames && !targetWorkloadNames.has(workloadName)) {
      continue;
    }
    const observedWorkload = input.observedState.workloads[workloadName];
    if (!observedWorkload) continue;

    const restoreSnapshot = await captureManagedWorkloadDesiredState(env, {
      spaceId: input.spaceId,
      serviceId: observedWorkload.serviceId,
      serviceName: `${input.desiredState.manifest.name}:${workloadName}`,
    });

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

      const consumeEnvPreview = await resolvedDeps.previewServiceConsumeEnvVars(
        env,
        {
          spaceId: input.spaceId,
          consumes: workloadSpec.consume,
        },
      );
      for (const entry of consumeEnvPreview) {
        const key = normalizeEnvName(entry.name);
        if (localEnvMap.has(key)) {
          throw new Error(
            `consume output resolves env '${key}' which already exists in compute '${workloadName}'`,
          );
        }
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

      const linkedCommonEnvState = await resolvedDeps
        .resolveLinkedCommonEnvState(
          env,
          input.spaceId,
          observedWorkload.serviceId,
        );
      for (const entry of linkedCommonEnvState.envBindings) {
        const key = normalizeEnvName(entry.name);
        if (localEnvMap.has(key)) {
          throw new Error(
            `common env '${key}' already exists in compute '${workloadName}'`,
          );
        }
        localEnvMap.set(key, {
          name: entry.name,
          value: entry.text ?? "",
          secret: entry.type === "secret_text",
        });
      }

      await desiredStateService.replaceLocalEnvVars({
        spaceId: input.spaceId,
        serviceId: observedWorkload.serviceId,
        variables: Array.from(localEnvMap.values()),
      });
    } catch (error) {
      try {
        await restoreManagedWorkloadDesiredState(env, restoreSnapshot, {
          createDesiredStateService: resolvedDeps.createDesiredStateService,
          replaceServiceConsumes: resolvedDeps.replaceServiceConsumes,
        });
      } catch (restoreError) {
        failures.push({
          name: workloadName,
          error: `${
            error instanceof Error ? error.message : String(error)
          }; rollback failed: ${
            restoreError instanceof Error
              ? restoreError.message
              : String(restoreError)
          }`,
        });
        continue;
      }
      failures.push({
        name: workloadName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return failures;
}
