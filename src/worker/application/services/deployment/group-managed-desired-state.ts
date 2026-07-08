import type {
  AppCompute,
  AppConsume,
  AppManifest,
  AppPublication,
  AppResourceBinding,
  AppServiceBinding,
} from "../source/app-manifest-types.ts";
import {
  isPublicationType,
  isRuntimeProjectionPublicationSourceType,
  listPublications,
  listServiceConsumes,
  previewServiceConsumeEnvVars,
  replaceRuntimeProjectionPublications,
  replaceServiceConsumes,
  resolveServiceConsumeEnvVars,
  RUNTIME_PROJECTION_CAPABILITIES,
  RUNTIME_PROJECTION_PUBLICATION_SOURCE_TYPE,
} from "../platform/service-publications.ts";
import { ServiceDesiredStateService } from "../platform/worker-desired-state.ts";
import { randomHex } from "../../../shared/utils/encoding-utils.ts";
import { resolveLinkedCommonEnvState } from "../platform/env-state-resolution.ts";
import { getGroupAutoHostname } from "../routing/group-hostnames.ts";
import {
  createServiceBinding,
  deleteServiceBinding,
} from "../resources/bindings.ts";
import type { Env } from "../../../shared/types/env.ts";
import {
  type GroupDesiredState,
  materializeRoutes,
  type ObservedGroupState,
  resolveWorkloadBaseUrl,
} from "./group-state.ts";
import { normalizeEnvName } from "../common-env/crypto.ts";
import {
  materializeTakosumiServiceGrant,
  type ServiceGrantMaterializer,
} from "./service-grants.ts";

function buildInjectedEnv(
  desiredState: GroupDesiredState,
  spaceId: string,
): Record<string, string> {
  return {
    TAKOS_SPACE_ID: spaceId,
    ...(desiredState.manifest.env ?? {}),
  };
}

type DesiredEnvVar = { name: string; value: string; secret: boolean };

type ManagedResourceRow = {
  id: string;
  name: string;
  config: {
    type: string;
    binding?: string;
    bindingName?: string;
    bindingType?: string;
  };
};

type DesiredResourceBinding = {
  resourceId: string;
  resourceName: string;
  bindingName: string;
  bindingType: string;
};

function readMcpAuthSecretRef(publication: AppPublication): string | null {
  if (
    !isPublicationType(
      publication.type,
      RUNTIME_PROJECTION_CAPABILITIES.mcpServer,
    )
  ) {
    return null;
  }
  const raw =
    publication.auth?.kind === "bearer"
      ? publication.auth.secretRef
      : publication.auth?.bearer?.secretRef;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? normalizeEnvName(trimmed) : null;
}

function collectMcpAuthSecretRefsForWorkload(
  manifest: Pick<AppManifest, "publish" | "routes">,
  workloadName: string,
): string[] {
  const refs = new Set<string>();
  for (const publication of manifest.publish ?? []) {
    const routeRefTargets = Object.values(publication.outputs ?? {}).map(
      (output) =>
        output.routeRef
          ? manifest.routes.find((route) => route.id === output.routeRef)
              ?.target
          : publication.publisher,
    );
    if (
      publication.publisher !== workloadName &&
      !routeRefTargets.includes(workloadName)
    )
      continue;
    const ref = readMcpAuthSecretRef(publication);
    if (ref) refs.add(ref);
  }
  return Array.from(refs).sort();
}

type DesiredStateService = Pick<
  ServiceDesiredStateService,
  "listLocalEnvVars" | "replaceLocalEnvVars" | "listResourceBindings"
>;

type PublicationSyncFailure = { name: string; error: string };

export type ManagedWorkloadDesiredStateSnapshot = {
  spaceId: string;
  serviceId: string;
  serviceName: string;
  groupId?: string | null;
  groupHostname?: string | null;
  consumes: AppConsume[];
  resourceBindings: Array<{
    name: string;
    type: string;
    resourceId: string;
  }>;
  localEnvVars: Array<{ name: string; value: string; secret: boolean }>;
};

function mapPreviousLocalEnvVars(
  snapshot: ManagedWorkloadDesiredStateSnapshot,
): Map<string, DesiredEnvVar> {
  const previous = new Map<string, DesiredEnvVar>();
  for (const entry of snapshot.localEnvVars) {
    try {
      previous.set(normalizeEnvName(entry.name), entry);
    } catch {
      // Ignore invalid previous names; they are restored only on rollback.
    }
  }
  return previous;
}

function ensureMcpAuthSecrets(
  localEnvMap: Map<string, DesiredEnvVar>,
  effectiveEnvMap: Map<string, DesiredEnvVar>,
  previousEnvVars: Map<string, DesiredEnvVar>,
  secretRefs: string[],
): void {
  for (const ref of secretRefs) {
    const key = normalizeEnvName(ref);
    if (effectiveEnvMap.has(key)) continue;
    const previous = previousEnvVars.get(key);
    const entry = {
      name: previous?.name ?? key,
      value: previous?.value ?? randomHex(32),
      secret: true,
    };
    localEnvMap.set(key, entry);
    effectiveEnvMap.set(key, entry);
  }
}

function collectServiceBindingsForWorkload(
  manifest: Pick<AppManifest, "serviceBindings">,
  workloadName: string,
): AppServiceBinding[] {
  return (manifest.serviceBindings ?? []).filter(
    (service) => service.target === workloadName,
  );
}

function inferServiceBindingInstallationId(
  explicitInstallationId: string | null | undefined,
  observedGroupId: string,
): string | null {
  const explicit = explicitInstallationId?.trim();
  if (explicit) return explicit;
  return /^inst_[A-Za-z0-9_-]+$/.test(observedGroupId) ? observedGroupId : null;
}

async function materializeServiceGrants(
  env: Env,
  serviceBindings: AppServiceBinding[],
  input: {
    spaceId: string;
    installationId?: string | null;
    observedGroupId: string;
    workloadName: string;
  },
  localEnvMap: Map<string, DesiredEnvVar>,
  effectiveEnvMap: Map<string, DesiredEnvVar>,
  previousEnvVars: Map<string, DesiredEnvVar>,
  materializer: ServiceGrantMaterializer,
): Promise<void> {
  const installationId = inferServiceBindingInstallationId(
    input.installationId,
    input.observedGroupId,
  );
  for (const serviceBinding of serviceBindings) {
    for (const envName of [
      serviceBinding.inject.baseUrlEnv,
      serviceBinding.inject.tokenEnv,
    ]) {
      if (!envName) continue;
      const key = normalizeEnvName(envName);
      if (effectiveEnvMap.has(key)) {
        throw new Error(
          `service binding '${serviceBinding.name}' inject env '${key}' already exists in compute '${input.workloadName}'`,
        );
      }
    }
  }

  for (const serviceBinding of serviceBindings) {
    if (!serviceBinding.inject.baseUrlEnv || !serviceBinding.inject.tokenEnv) {
      throw new Error(
        `service binding '${serviceBinding.name}' inject.baseUrlEnv and inject.tokenEnv are required`,
      );
    }
    const baseUrlEnv = normalizeEnvName(serviceBinding.inject.baseUrlEnv);
    const tokenEnv = normalizeEnvName(serviceBinding.inject.tokenEnv);
    const materialized = await materializer(env, {
      spaceId: input.spaceId,
      installationId,
      workloadName: input.workloadName,
      serviceBinding,
      previousToken: previousEnvVars.get(tokenEnv)?.value,
    });
    const baseUrlEntry = {
      name: baseUrlEnv,
      value: materialized.baseUrl,
      secret: false,
    };
    const tokenEntry = {
      name: tokenEnv,
      value: materialized.token,
      secret: true,
    };
    localEnvMap.set(baseUrlEnv, baseUrlEntry);
    localEnvMap.set(tokenEnv, tokenEntry);
    effectiveEnvMap.set(baseUrlEnv, baseUrlEntry);
    effectiveEnvMap.set(tokenEnv, tokenEntry);
  }
}

function reserveEffectiveEnvVar(
  effectiveEnvMap: Map<string, DesiredEnvVar>,
  entry: DesiredEnvVar,
  errorMessage: string,
): void {
  const key = normalizeEnvName(entry.name);
  if (effectiveEnvMap.has(key)) {
    throw new Error(errorMessage);
  }
  effectiveEnvMap.set(key, entry);
}

export type GroupManagedDesiredStateDeps = {
  createDesiredStateService: (env: Env) => DesiredStateService;
  listServiceConsumes: typeof listServiceConsumes;
  previewServiceConsumeEnvVars: typeof previewServiceConsumeEnvVars;
  replaceRuntimeProjectionPublications: typeof replaceRuntimeProjectionPublications;
  replaceServiceConsumes: typeof replaceServiceConsumes;
  resolveServiceConsumeEnvVars: typeof resolveServiceConsumeEnvVars;
  resolveLinkedCommonEnvState: typeof resolveLinkedCommonEnvState;
  createServiceBinding: typeof createServiceBinding;
  deleteServiceBinding: typeof deleteServiceBinding;
  materializeServiceGrant: ServiceGrantMaterializer;
};

type ManagedWorkloadDesiredStateHelpers = {
  createDesiredStateService: (env: Env) => DesiredStateService;
  listServiceConsumes: typeof listServiceConsumes;
  replaceServiceConsumes: typeof replaceServiceConsumes;
  createServiceBinding: typeof createServiceBinding;
  deleteServiceBinding: typeof deleteServiceBinding;
};

const defaultGroupManagedDesiredStateDeps: GroupManagedDesiredStateDeps = {
  createDesiredStateService: (env: Env) => new ServiceDesiredStateService(env),
  listServiceConsumes,
  previewServiceConsumeEnvVars,
  replaceRuntimeProjectionPublications,
  replaceServiceConsumes,
  resolveServiceConsumeEnvVars,
  resolveLinkedCommonEnvState,
  createServiceBinding,
  deleteServiceBinding,
  materializeServiceGrant: materializeTakosumiServiceGrant,
};

const defaultManagedWorkloadDesiredStateHelpers: ManagedWorkloadDesiredStateHelpers =
  {
    createDesiredStateService: (env: Env) =>
      new ServiceDesiredStateService(env),
    listServiceConsumes,
    replaceServiceConsumes,
    createServiceBinding,
    deleteServiceBinding,
  };

export { materializeRoutes, resolveWorkloadBaseUrl };

async function captureManagedPublicationSnapshot(
  env: Env,
  spaceId: string,
  groupId: string,
): Promise<AppPublication[]> {
  const publications = await listPublications(env, spaceId);
  return publications
    .filter(
      (publication) =>
        publication.groupId === groupId &&
        isRuntimeProjectionPublicationSourceType(publication.sourceType),
    )
    .map((publication) => publication.publication);
}

function manifestRoutesFromObservedState(
  observedState: ObservedGroupState,
): Array<{ id?: string; target: string; path: string }> {
  return Object.entries(observedState.routes).flatMap(([name, route]) => {
    if (typeof route.path !== "string" || route.path.length === 0) {
      return [];
    }
    return [
      {
        id: route.name || name,
        target: route.target,
        path: route.path,
      },
    ];
  });
}

function normalizeBindingName(name: string): string {
  return normalizeEnvName(name);
}

function collectDesiredResourceBindingsForWorkload(
  desiredState: GroupDesiredState,
  resourceRows: ManagedResourceRow[],
  workloadName: string,
): DesiredResourceBinding[] {
  const rowsByName = new Map(resourceRows.map((row) => [row.name, row]));
  const bindings: DesiredResourceBinding[] = [];

  for (const [resourceName, desiredResource] of Object.entries(
    desiredState.resources,
  )) {
    const targetBindings = (desiredResource.spec.bindings ?? []).filter(
      (binding: AppResourceBinding) => binding.target === workloadName,
    );
    if (targetBindings.length === 0) continue;

    const row = rowsByName.get(resourceName);
    if (!row) {
      throw new Error(
        `resource '${resourceName}' is not provisioned for compute '${workloadName}'`,
      );
    }
    const bindingType = row.config.bindingType ?? row.config.type;
    for (const binding of targetBindings) {
      bindings.push({
        resourceId: row.id,
        resourceName,
        bindingName: normalizeBindingName(binding.binding),
        bindingType,
      });
    }
  }

  return bindings.sort(
    (a, b) =>
      a.resourceName.localeCompare(b.resourceName) ||
      a.bindingName.localeCompare(b.bindingName),
  );
}

async function syncManagedResourceBindingsForWorkload(
  env: Env,
  input: {
    serviceId: string;
    desiredState: GroupDesiredState;
    workloadName: string;
    resourceRows: ManagedResourceRow[];
  },
  deps: Pick<
    GroupManagedDesiredStateDeps,
    | "createDesiredStateService"
    | "createServiceBinding"
    | "deleteServiceBinding"
  >,
): Promise<void> {
  const desiredBindings = collectDesiredResourceBindingsForWorkload(
    input.desiredState,
    input.resourceRows,
    input.workloadName,
  );
  const desiredResourceNames = new Set(
    Object.keys(input.desiredState.resources),
  );
  const desiredByResourceId = new Map(
    desiredBindings.map((binding) => [binding.resourceId, binding]),
  );
  const desiredStateService = deps.createDesiredStateService(env);
  const currentBindings = await desiredStateService.listResourceBindings(
    input.serviceId,
  );

  for (const current of currentBindings) {
    if (
      !current.resource_name ||
      !desiredResourceNames.has(current.resource_name)
    ) {
      continue;
    }
    const desired = desiredByResourceId.get(current.resource_id);
    if (!desired || desired.bindingName !== current.name) {
      await deps.deleteServiceBinding(
        env.DB,
        current.resource_id,
        input.serviceId,
      );
    }
  }

  const refreshedBindings = await desiredStateService.listResourceBindings(
    input.serviceId,
  );
  const currentByResourceId = new Map(
    refreshedBindings.map((binding) => [binding.resource_id, binding]),
  );
  const now = new Date().toISOString();
  for (const desired of desiredBindings) {
    const current = currentByResourceId.get(desired.resourceId);
    if (current?.name === desired.bindingName) continue;
    if (current) {
      await deps.deleteServiceBinding(
        env.DB,
        desired.resourceId,
        input.serviceId,
      );
    }
    await deps.createServiceBinding(env.DB, {
      id: crypto.randomUUID(),
      service_id: input.serviceId,
      resource_id: desired.resourceId,
      binding_name: desired.bindingName,
      binding_type: desired.bindingType,
      config: {},
      created_at: now,
    });
  }
}

export async function syncGroupPublicationDesiredState(
  env: Env,
  input: {
    spaceId: string;
    desiredState: GroupDesiredState;
    observedState: ObservedGroupState;
  },
  deps: Partial<
    Pick<GroupManagedDesiredStateDeps, "replaceRuntimeProjectionPublications">
  > = {},
): Promise<PublicationSyncFailure[]> {
  const resolvedDeps = {
    replaceRuntimeProjectionPublications:
      deps.replaceRuntimeProjectionPublications ??
      replaceRuntimeProjectionPublications,
  };
  let snapshot: AppPublication[];
  try {
    snapshot = await captureManagedPublicationSnapshot(
      env,
      input.spaceId,
      input.observedState.groupId,
    );
  } catch (error) {
    return [
      {
        name: "publications",
        error: error instanceof Error ? error.message : String(error),
      },
    ];
  }

  try {
    await resolvedDeps.replaceRuntimeProjectionPublications(env, {
      spaceId: input.spaceId,
      groupId: input.observedState.groupId,
      manifest: {
        publish: input.desiredState.manifest.publish,
        routes: input.desiredState.manifest.routes,
      },
      observedState: input.observedState,
    });
  } catch (error) {
    try {
      await resolvedDeps.replaceRuntimeProjectionPublications(env, {
        spaceId: input.spaceId,
        groupId: input.observedState.groupId,
        manifest: {
          publish: snapshot,
          routes: manifestRoutesFromObservedState(input.observedState),
        },
        observedState: input.observedState,
      });
    } catch (restoreError) {
      return [
        {
          name: "publications",
          error: `${
            error instanceof Error ? error.message : String(error)
          }; rollback failed: ${
            restoreError instanceof Error
              ? restoreError.message
              : String(restoreError)
          }`,
        },
      ];
    }

    return [
      {
        name: "publications",
        error: error instanceof Error ? error.message : String(error),
      },
    ];
  }

  return [];
}

export async function captureManagedWorkloadDesiredState(
  env: Env,
  params: {
    spaceId: string;
    serviceId: string;
    serviceName: string;
    groupId?: string | null;
    groupHostname?: string | null;
  },
  deps: Partial<ManagedWorkloadDesiredStateHelpers> = {},
): Promise<ManagedWorkloadDesiredStateSnapshot> {
  const resolvedDeps = {
    ...defaultManagedWorkloadDesiredStateHelpers,
    ...deps,
  };
  const desiredStateService = resolvedDeps.createDesiredStateService(env);
  const [consumes, localEnvVars, resourceBindings] = await Promise.all([
    resolvedDeps.listServiceConsumes(env, params.spaceId, params.serviceId),
    desiredStateService.listLocalEnvVars(params.spaceId, params.serviceId),
    desiredStateService.listResourceBindings(params.serviceId),
  ]);

  return {
    spaceId: params.spaceId,
    serviceId: params.serviceId,
    serviceName: params.serviceName,
    groupId: params.groupId ?? null,
    groupHostname: params.groupHostname,
    consumes,
    resourceBindings: resourceBindings.map((row) => ({
      name: row.name,
      type: row.type,
      resourceId: row.resource_id,
    })),
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
      consumerGroupId: snapshot.groupId,
      groupHostname: snapshot.groupHostname,
      consumes: snapshot.consumes,
    });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    const currentBindings = await desiredStateService.listResourceBindings(
      snapshot.serviceId,
    );
    for (const current of currentBindings) {
      await resolvedDeps.deleteServiceBinding(
        env.DB,
        current.resource_id,
        snapshot.serviceId,
      );
    }
    const now = new Date().toISOString();
    for (const binding of snapshot.resourceBindings) {
      await resolvedDeps.createServiceBinding(env.DB, {
        id: crypto.randomUUID(),
        service_id: snapshot.serviceId,
        resource_id: binding.resourceId,
        binding_name: binding.name,
        binding_type: binding.type,
        config: {},
        created_at: now,
      });
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    await desiredStateService.replaceLocalEnvVars({
      spaceId: snapshot.spaceId,
      serviceId: snapshot.serviceId,
      variables: snapshot.localEnvVars,
    });
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
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
    resourceRows: ManagedResourceRow[];
    targetWorkloadNames?: string[];
    syncPublications?: boolean;
    installationId?: string | null;
  },
  deps: Partial<GroupManagedDesiredStateDeps> = {},
): Promise<Array<{ name: string; error: string }>> {
  const resolvedDeps: GroupManagedDesiredStateDeps = {
    ...defaultGroupManagedDesiredStateDeps,
    ...deps,
  };
  const desiredStateService = resolvedDeps.createDesiredStateService(env);
  const injectedEnv = buildInjectedEnv(input.desiredState, input.spaceId);
  const failures: Array<{ name: string; error: string }> = [];
  const groupHostname = await getGroupAutoHostname(env, {
    groupId: input.observedState.groupId,
    spaceId: input.spaceId,
  });
  const targetWorkloadNames = input.targetWorkloadNames
    ? new Set(
        input.targetWorkloadNames.map((name) => name.trim()).filter(Boolean),
      )
    : null;

  for (const [workloadName, desiredWorkload] of Object.entries(
    input.desiredState.workloads,
  )) {
    if (targetWorkloadNames && !targetWorkloadNames.has(workloadName)) {
      continue;
    }
    const observedWorkload = input.observedState.workloads[workloadName];
    if (!observedWorkload) continue;

    const restoreSnapshot = await captureManagedWorkloadDesiredState(
      env,
      {
        spaceId: input.spaceId,
        serviceId: observedWorkload.serviceId,
        serviceName: `${input.desiredState.manifest.name}:${workloadName}`,
        groupId: input.observedState.groupId,
        groupHostname,
      },
      {
        createDesiredStateService: resolvedDeps.createDesiredStateService,
        listServiceConsumes: resolvedDeps.listServiceConsumes,
        replaceServiceConsumes: resolvedDeps.replaceServiceConsumes,
        createServiceBinding: resolvedDeps.createServiceBinding,
        deleteServiceBinding: resolvedDeps.deleteServiceBinding,
      },
    );

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
      const effectiveEnvMap = new Map<string, DesiredEnvVar>();
      for (const [name, value] of Object.entries(injectedEnv)) {
        const key = normalizeEnvName(name);
        const entry = {
          name,
          value,
          secret: false,
        };
        localEnvMap.set(key, entry);
        effectiveEnvMap.set(key, entry);
      }
      for (const entry of specEnv) {
        const key = normalizeEnvName(entry.name);
        const value = {
          name: entry.name,
          value: entry.value,
          secret: entry.secret,
        };
        localEnvMap.set(key, value);
        effectiveEnvMap.set(key, value);
      }

      const serviceBindings = collectServiceBindingsForWorkload(
        input.desiredState.manifest,
        workloadName,
      );
      const preReservedRuntimeEnvKeys = new Set<string>();

      const consumeEnvPreview = await resolvedDeps.previewServiceConsumeEnvVars(
        env,
        {
          spaceId: input.spaceId,
          consumerGroupId: input.observedState.groupId,
          consumes: workloadSpec.consume,
        },
      );
      for (const entry of consumeEnvPreview) {
        const key = normalizeEnvName(entry.name);
        if (effectiveEnvMap.has(key)) {
          throw new Error(
            `consume output resolves env '${key}' which already exists in compute '${workloadName}'`,
          );
        }
        if (serviceBindings.length > 0) {
          effectiveEnvMap.set(key, {
            name: entry.name,
            value: "",
            secret: entry.secret,
          });
          preReservedRuntimeEnvKeys.add(key);
        }
      }

      if (serviceBindings.length > 0) {
        const linkedCommonEnvState =
          await resolvedDeps.resolveLinkedCommonEnvState(
            env,
            input.spaceId,
            observedWorkload.serviceId,
          );
        for (const entry of linkedCommonEnvState.envBindings) {
          const key = normalizeEnvName(entry.name);
          reserveEffectiveEnvVar(
            effectiveEnvMap,
            {
              name: entry.name,
              value: entry.text ?? "",
              secret: entry.type === "secret_text",
            },
            `common env '${key}' already exists in compute '${workloadName}'`,
          );
          preReservedRuntimeEnvKeys.add(key);
        }

        ensureMcpAuthSecrets(
          localEnvMap,
          effectiveEnvMap,
          mapPreviousLocalEnvVars(restoreSnapshot),
          collectMcpAuthSecretRefsForWorkload(
            input.desiredState.manifest,
            workloadName,
          ),
        );

        await materializeServiceGrants(
          env,
          serviceBindings,
          {
            spaceId: input.spaceId,
            installationId: input.installationId,
            observedGroupId: input.observedState.groupId,
            workloadName,
          },
          localEnvMap,
          effectiveEnvMap,
          mapPreviousLocalEnvVars(restoreSnapshot),
          resolvedDeps.materializeServiceGrant,
        );
      }

      await resolvedDeps.replaceServiceConsumes(env, {
        spaceId: input.spaceId,
        serviceId: observedWorkload.serviceId,
        serviceName: `${input.desiredState.manifest.name}:${workloadName}`,
        consumerGroupId: input.observedState.groupId,
        groupHostname,
        consumes: workloadSpec.consume,
      });

      const consumeEnvVars = await resolvedDeps.resolveServiceConsumeEnvVars(
        env,
        {
          spaceId: input.spaceId,
          serviceId: observedWorkload.serviceId,
        },
      );
      for (const entry of consumeEnvVars) {
        const key = normalizeEnvName(entry.name);
        if (effectiveEnvMap.has(key)) {
          if (preReservedRuntimeEnvKeys.has(key)) continue;
          throw new Error(
            `consume output resolves env '${key}' which already exists in compute '${workloadName}'`,
          );
        }
        effectiveEnvMap.set(key, {
          name: entry.name,
          value: entry.value,
          secret: entry.secret,
        });
      }

      const linkedCommonEnvState =
        await resolvedDeps.resolveLinkedCommonEnvState(
          env,
          input.spaceId,
          observedWorkload.serviceId,
        );
      for (const entry of linkedCommonEnvState.envBindings) {
        const key = normalizeEnvName(entry.name);
        if (effectiveEnvMap.has(key)) {
          if (preReservedRuntimeEnvKeys.has(key)) continue;
          throw new Error(
            `common env '${key}' already exists in compute '${workloadName}'`,
          );
        }
        effectiveEnvMap.set(key, {
          name: entry.name,
          value: entry.text ?? "",
          secret: entry.type === "secret_text",
        });
      }

      ensureMcpAuthSecrets(
        localEnvMap,
        effectiveEnvMap,
        mapPreviousLocalEnvVars(restoreSnapshot),
        collectMcpAuthSecretRefsForWorkload(
          input.desiredState.manifest,
          workloadName,
        ),
      );

      await syncManagedResourceBindingsForWorkload(
        env,
        {
          serviceId: observedWorkload.serviceId,
          desiredState: input.desiredState,
          workloadName,
          resourceRows: input.resourceRows,
        },
        {
          createDesiredStateService: resolvedDeps.createDesiredStateService,
          createServiceBinding: resolvedDeps.createServiceBinding,
          deleteServiceBinding: resolvedDeps.deleteServiceBinding,
        },
      );

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

  if (input.syncPublications !== false && failures.length === 0) {
    failures.push(
      ...(await syncGroupPublicationDesiredState(
        env,
        {
          spaceId: input.spaceId,
          desiredState: input.desiredState,
          observedState: input.observedState,
        },
        {
          replaceRuntimeProjectionPublications:
            resolvedDeps.replaceRuntimeProjectionPublications,
        },
      )),
    );
  }

  return failures;
}
