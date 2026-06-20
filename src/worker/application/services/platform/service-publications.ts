import { BadRequestError } from "@takos/worker-platform-utils/errors";

import type {
  AppCompute,
  AppConsume,
  AppPublication,
} from "../source/app-manifest-types.ts";
import type { ObservedGroupState } from "../deployment/group-state.ts";
import { getGroupAutoHostname } from "../routing/group-hostnames.ts";
import { RESERVED_TAKOS_PUBLICATION_MESSAGE } from "../identity/takos-access-tokens.ts";
import type { Env } from "../../../shared/types/index.ts";
import { GoneError } from "@takos/worker-platform-utils/errors";
import {
  assertConsumeOutputAliases,
  buildPublicUrl,
  collectManifestConsumeEntries,
  type ConsumeEntry,
  consumeLocalName,
  isReservedTakosPublicationSource,
  normalizeEnvName,
  normalizePublicationDefinition,
  normalizeServiceConsumes,
  type PublicationOutputDescriptor,
  resolveConsumeOutputEnvName,
  selectedConsumeOutputs,
} from "./service-publications-normalize.ts";
import {
  assertPublicationHasNoConsumers,
  deletePublicationRow,
  deleteServiceConsumeRow,
  SERVICE_GRAPH_PUBLICATION_SOURCE_TYPE,
  getPublicationRowByRef,
  getServiceGroupId,
  listPublicationRows,
  listServiceConsumeRows,
  parseConsumeConfig,
  parseConsumeState,
  publicationOutputContract,
  type PublicationRecord,
  type ServiceConsumeRow,
  toPublicationRecord,
  upsertPublicationRow,
  upsertServiceConsumeRow,
} from "./service-publications-db.ts";
import {
  cleanupConsumeState,
  type ConsumePublicationDefinition,
  resolveConsumePublicationDefinition,
  syncConsumersForPublication,
  syncConsumeState,
} from "./service-publications-consume.ts";
import { resolveServiceGraphExportDefinition } from "./service-graph-exports.ts";

export {
  buildPublicUrl,
  canonicalPublicationType,
  isPublicationType,
  normalizeApiPublicationDefinition,
  normalizePublicationDefinition,
  normalizeServiceConsumes,
  publicationAllowedFields,
  type PublicationOutputDescriptor,
  resolveConsumeOutputEnvName,
  SERVICE_GRAPH_CAPABILITIES,
} from "./service-publications-normalize.ts";

export {
  SERVICE_GRAPH_PUBLICATION_SOURCE_TYPE,
  publicationOutputContract,
  type PublicationRecord,
  publicationResolvedUrl,
} from "./service-publications-db.ts";

function findRouteTargetForPublication(
  publication: AppPublication,
  manifestRoutes: Array<{ id?: string; target: string; path: string }>,
  output: { routeRef?: string },
): { target: string; path: string } {
  const routeRef = output.routeRef?.trim();
  if (!routeRef) {
    throw new Error(
      `publication '${publication.name}' is missing routeRef output`,
    );
  }
  const route = manifestRoutes.find((entry) => entry.id === routeRef);
  if (!route) {
    throw new Error(
      `publication '${publication.name}' routeRef '${routeRef}' does not match any route id`,
    );
  }
  if (publication.publisher && publication.publisher !== route.target) {
    throw new Error(
      `publication '${publication.name}' publisher '${publication.publisher}' does not match routeRef '${routeRef}' target '${route.target}'`,
    );
  }
  return { target: route.target, path: route.path };
}

export function resolveRoutePublication(
  publication: AppPublication,
  observedState: ObservedGroupState,
  manifestRoutes: Array<{ id?: string; target: string; path: string }>,
  options: { groupHostname?: string | null } = {},
): { ownerServiceId: string; resolved: Record<string, string> } {
  const outputs = publication.outputs ?? {};
  const resolved: Record<string, string> = {};
  let ownerServiceId: string | null = null;
  let ownerTarget: string | null = null;
  for (const [outputName, output] of Object.entries(outputs)) {
    const route = findRouteTargetForPublication(
      publication,
      manifestRoutes,
      output,
    );
    if (ownerTarget && ownerTarget !== route.target) {
      throw new Error(
        `publication '${publication.name}' route outputs must resolve to the same target`,
      );
    }
    ownerTarget ??= route.target;
    const target = route.target;
    const workload = observedState.workloads[target];
    const hostname = options.groupHostname ?? workload?.hostname;
    if (!workload?.serviceId || !hostname) {
      throw new Error(
        `publication '${publication.name}' cannot resolve route target '${target}'`,
      );
    }
    ownerServiceId ??= workload.serviceId;
    resolved[outputName] = buildPublicUrl(hostname, route.path);
  }
  if (!ownerServiceId || Object.keys(resolved).length === 0) {
    throw new Error(
      `publication '${publication.name}' does not declare any route outputs`,
    );
  }
  return {
    ownerServiceId,
    resolved,
  };
}

async function resolvePublicationOutputValues(
  env: Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
  params: {
    spaceId: string;
    serviceId: string;
    publication: PublicationRecord;
    consumeRow?: ServiceConsumeRow;
  },
): Promise<Record<string, { value: string; secret: boolean }>> {
  const publication = params.publication.publication;
  void env;
  void params.spaceId;
  void params.serviceId;
  void params.consumeRow;
  return Object.fromEntries(
    publicationOutputContract(publication).map((output) => {
      const value = params.publication.resolved[output.name];
      if (!value) {
        throw new Error(
          `publication '${publication.name}' does not have resolved output '${output.name}'`,
        );
      }
      return [output.name, { value, secret: output.secret }];
    }),
  );
}

export async function listPublications(
  env: Pick<Env, "DB">,
  spaceId: string,
): Promise<PublicationRecord[]> {
  const rows = await listPublicationRows(env, spaceId);
  return rows.map(toPublicationRecord);
}

export async function getPublicationByName(
  env: Pick<Env, "DB">,
  spaceId: string,
  name: string,
  opts: { consumerGroupId?: string | null } = {},
): Promise<PublicationRecord | null> {
  const row = await getPublicationRowByRef(env, {
    spaceId,
    ref: name,
    consumerGroupId: opts.consumerGroupId,
  });
  return row ? toPublicationRecord(row) : null;
}

export async function replaceServiceGraphPublications(
  env: Pick<
    Env,
    "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN" | "TENANT_BASE_DOMAIN"
  >,
  params: {
    spaceId: string;
    groupId: string;
    manifest: {
      publish?: AppPublication[];
      routes?: Array<{ id?: string; target: string; path: string }>;
    };
    observedState: ObservedGroupState;
  },
): Promise<void> {
  const groupHostname = await getGroupAutoHostname(env, {
    groupId: params.groupId,
    spaceId: params.spaceId,
  });
  const desired = (params.manifest.publish ?? []).map((publication) =>
    normalizePublicationDefinition(publication),
  );
  const desiredByName = new Map(
    desired.map((publication) => [publication.name, publication]),
  );
  const existingRows = await listPublicationRows(env, params.spaceId, {
    groupId: params.groupId,
  });
  const staleRows = existingRows.filter(
    (row) =>
      row.groupId === params.groupId &&
      row.sourceType === SERVICE_GRAPH_PUBLICATION_SOURCE_TYPE &&
      !desiredByName.has(row.name),
  );
  for (const row of staleRows) {
    await assertPublicationHasNoConsumers(env, params.spaceId, row);
  }
  for (const publication of desired) {
    const routeResolved = resolveRoutePublication(
      publication,
      params.observedState,
      params.manifest.routes ?? [],
      { groupHostname },
    );
    const row = await upsertPublicationRow(env, {
      spaceId: params.spaceId,
      groupId: params.groupId,
      ownerServiceId: routeResolved.ownerServiceId,
      sourceType: SERVICE_GRAPH_PUBLICATION_SOURCE_TYPE,
      publication,
      resolved: routeResolved.resolved,
    });
    await syncConsumersForPublication(env, {
      spaceId: params.spaceId,
      publication: row,
    });
  }

  for (const row of staleRows) {
    await deletePublicationRow(env, row);
  }
}

export async function assertServiceGraphPublicationPrerequisites(
  env: Pick<Env, "DB"> &
    Partial<
      Pick<Env, "TENANT_BASE_DOMAIN" | "AUTH_PUBLIC_BASE_URL" | "ADMIN_DOMAIN">
    >,
  params: {
    spaceId: string;
    groupId?: string;
    manifest: {
      compute?: Record<string, AppCompute>;
      env?: Record<string, string>;
      publish?: AppPublication[];
    };
  },
): Promise<void> {
  const errors: string[] = [];
  const desiredByName = new Map<string, AppPublication>();
  let groupHostname: string | null | undefined;
  async function resolveGroupHostname(): Promise<string | null> {
    if (!params.groupId) return null;
    if (groupHostname !== undefined) return groupHostname;
    groupHostname = await getGroupAutoHostname(
      {
        DB: env.DB,
        TENANT_BASE_DOMAIN: env.TENANT_BASE_DOMAIN ?? "",
      },
      {
        groupId: params.groupId,
        spaceId: params.spaceId,
      },
    );
    return groupHostname;
  }

  for (const publication of params.manifest.publish ?? []) {
    let normalized: AppPublication;
    try {
      normalized = normalizePublicationDefinition(publication);
      desiredByName.set(normalized.name, normalized);
    } catch (error) {
      const name = publication.name || "(unnamed)";
      errors.push(
        `publication '${name}': ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }
  }

  const publicationRecordCache = new Map<string, PublicationRecord | null>();
  async function resolveConsumePublication(consume: AppConsume): Promise<{
    publication: AppPublication;
    outputs: PublicationOutputDescriptor[];
  } | null> {
    const name = consume.publication;
    if (isReservedTakosPublicationSource(name)) {
      throw new GoneError(RESERVED_TAKOS_PUBLICATION_MESSAGE);
    }
    const manifestPublication = desiredByName.get(name);
    if (manifestPublication) {
      return {
        publication: manifestPublication,
        outputs: publicationOutputContract(manifestPublication),
      };
    }
    if (!publicationRecordCache.has(name)) {
      publicationRecordCache.set(
        name,
        await getPublicationByName(env, params.spaceId, name, {
          consumerGroupId: params.groupId,
        }),
      );
    }
    const record = publicationRecordCache.get(name) ?? null;
    const serviceGraphExport = record
      ? null
      : resolveServiceGraphExportDefinition(env, {
          spaceId: params.spaceId,
          name,
        });
    return record
      ? { publication: record.publication, outputs: record.outputs }
      : serviceGraphExport
        ? {
            publication: serviceGraphExport.publication,
            outputs: serviceGraphExport.outputs,
          }
        : null;
  }

  const topLevelEnvNames = new Set<string>();
  for (const name of Object.keys(params.manifest.env ?? {})) {
    try {
      topLevelEnvNames.add(normalizeEnvName(name));
    } catch {
      // Static deploy validation reports invalid env names with a precise path.
    }
  }
  const seenByCompute = new Map<string, Set<string>>();
  function seenEnvForCompute(entry: ConsumeEntry): Set<string> {
    const existing = seenByCompute.get(entry.computeName);
    if (existing) return existing;
    const seen = new Set(topLevelEnvNames);
    for (const name of Object.keys(entry.compute.env ?? {})) {
      try {
        seen.add(normalizeEnvName(name));
      } catch {
        // Static deploy validation reports invalid env names with a precise path.
      }
    }
    seenByCompute.set(entry.computeName, seen);
    return seen;
  }

  for (const entry of collectManifestConsumeEntries(params.manifest)) {
    let publication: {
      publication: AppPublication;
      outputs: PublicationOutputDescriptor[];
    } | null;
    try {
      publication = await resolveConsumePublication(entry.consume);
    } catch (error) {
      errors.push(
        `${entry.path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }
    if (!publication) {
      errors.push(
        `${entry.path}: consume references unknown publication '${entry.consume.publication}' in this space`,
      );
      continue;
    }
    const manifestPublication = desiredByName.get(entry.consume.publication);
    if (
      manifestPublication &&
      params.groupId &&
      !(await resolveGroupHostname())
    ) {
      errors.push(
        `${entry.path}: consume references same-manifest route publication '${entry.consume.publication}' but the group hostname is unavailable`,
      );
      continue;
    }
    try {
      assertConsumeOutputAliases(entry.consume, publication.outputs);
    } catch (error) {
      errors.push(
        `${entry.path}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }
    const seen = seenEnvForCompute(entry);
    for (const output of selectedConsumeOutputs(
      entry.consume,
      publication.outputs,
    )) {
      let envName: string;
      try {
        envName = resolveConsumeOutputEnvName(entry.consume, output);
      } catch (error) {
        errors.push(
          `${entry.path}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        continue;
      }
      if (seen.has(envName)) {
        errors.push(
          `${entry.path}: consume '${entry.consume.publication}' resolves env '${envName}' which already exists in compute '${entry.computeName}'`,
        );
        continue;
      }
      seen.add(envName);
    }
  }

  if (errors.length === 0) return;
  const header =
    errors.length === 1
      ? "Publication prerequisite validation failed:"
      : `Publication prerequisite validation failed (${errors.length} errors):`;
  throw new BadRequestError(
    [header, ...errors.map((error) => `  - ${error}`)].join("\n"),
    { errors },
  );
}

export async function listServiceConsumes(
  env: Pick<Env, "DB">,
  spaceId: string,
  serviceId: string,
): Promise<AppConsume[]> {
  const rows = await listServiceConsumeRows(env, spaceId, serviceId);
  return rows
    .map(parseConsumeConfig)
    .sort((a, b) => consumeLocalName(a).localeCompare(consumeLocalName(b)));
}

export async function replaceServiceConsumes(
  env: Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
  params: {
    spaceId: string;
    serviceId: string;
    serviceName: string;
    consumerGroupId?: string | null;
    groupHostname?: string | null;
    consumes?: AppConsume[];
  },
): Promise<AppConsume[]> {
  const consumes = normalizeServiceConsumes(params.consumes);
  const consumeByName = new Map(
    consumes.map((consume) => [consumeLocalName(consume), consume]),
  );
  const existingRows = await listServiceConsumeRows(
    env,
    params.spaceId,
    params.serviceId,
  );
  const publicationDefinitions = await Promise.all(
    consumes.map((consume) =>
      resolveConsumePublicationDefinition(env, {
        spaceId: params.spaceId,
        consume,
        consumerGroupId: params.consumerGroupId,
      }),
    ),
  );
  const publicationMap = new Map<string, ConsumePublicationDefinition>();
  publicationDefinitions.forEach((definition, index) => {
    if (!definition) {
      throw new Error(
        `consume references unknown publication: ${
          consumes[index].publication
        }`,
      );
    }
    publicationMap.set(consumeLocalName(consumes[index]), definition);
  });

  for (const row of existingRows) {
    if (consumeByName.has(row.publicationName)) continue;
    const existingConsume = parseConsumeConfig(row);
    let publication = publicationMap.get(row.publicationName) ?? null;
    if (!publication) {
      try {
        publication = await resolveConsumePublicationDefinition(env, {
          spaceId: params.spaceId,
          consume: existingConsume,
          consumerGroupId: params.consumerGroupId,
        });
      } catch (error) {
        if (!(error instanceof GoneError)) throw error;
      }
    }
    const state = parseConsumeState(row);
    if (publication) {
      await cleanupConsumeState(env, {
        spaceId: params.spaceId,
        serviceId: params.serviceId,
        publication: publication.publication,
        state,
      });
    }
    await deleteServiceConsumeRow(env, row);
  }

  for (const consume of consumes) {
    const localName = consumeLocalName(consume);
    const existing = existingRows.find(
      (row) => row.publicationName === localName,
    );
    const publication = publicationMap.get(localName);
    if (!publication) {
      throw new Error(
        `consume references unknown publication: ${consume.publication}`,
      );
    }
    assertConsumeOutputAliases(consume, publication.outputs);
    const state = await syncConsumeState(env, {
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      serviceName: params.serviceName,
      publication: publication.publication,
      consumeRow: existing,
    });
    await upsertServiceConsumeRow(env, {
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      consume,
      state,
    });
  }

  return listServiceConsumes(env, params.spaceId, params.serviceId);
}

export async function previewServiceConsumeEnvVars(
  env: Pick<Env, "DB">,
  params: {
    spaceId: string;
    consumerGroupId?: string | null;
    consumes?: AppConsume[];
  },
): Promise<Array<{ name: string; secret: boolean }>> {
  const consumes = normalizeServiceConsumes(params.consumes);
  const publicationDefinitions = await Promise.all(
    consumes.map((consume) =>
      resolveConsumePublicationDefinition(env, {
        spaceId: params.spaceId,
        consume,
        consumerGroupId: params.consumerGroupId,
      }),
    ),
  );
  const out = new Map<string, { secret: boolean }>();

  publicationDefinitions.forEach((publication, index) => {
    const consume = consumes[index];
    if (!publication) {
      throw new Error(
        `consume references unknown publication: ${consume.publication}`,
      );
    }
    assertConsumeOutputAliases(consume, publication.outputs);
    for (const output of selectedConsumeOutputs(consume, publication.outputs)) {
      const envName = resolveConsumeOutputEnvName(consume, output);
      if (out.has(envName)) {
        throw new Error(
          `multiple consumes resolve to the same environment variable: ${envName}`,
        );
      }
      out.set(envName, { secret: output.secret });
    }
  });

  return Array.from(out.entries()).map(([name, value]) => ({
    name,
    secret: value.secret,
  }));
}

export async function deleteServiceConsumes(
  env: Pick<Env, "DB"> | Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
  params: {
    spaceId: string;
    serviceId: string;
  },
): Promise<void> {
  const rows = await listServiceConsumeRows(
    env,
    params.spaceId,
    params.serviceId,
  );
  const consumerGroupId = await getServiceGroupId(
    env,
    params.spaceId,
    params.serviceId,
  );
  for (const row of rows) {
    const state = parseConsumeState(row);
    const consume = parseConsumeConfig(row);
    let publication: ConsumePublicationDefinition | null = null;
    try {
      publication = await resolveConsumePublicationDefinition(env, {
        spaceId: params.spaceId,
        consume,
        consumerGroupId,
      });
    } catch (error) {
      if (!(error instanceof GoneError)) throw error;
    }
    if (publication) {
      await cleanupConsumeState(env, {
        spaceId: params.spaceId,
        serviceId: params.serviceId,
        publication: publication.publication,
        state,
      });
    }
    await deleteServiceConsumeRow(env, row);
  }
}

export async function resolveServiceConsumeEnvVars(
  env: Pick<Env, "DB" | "ENCRYPTION_KEY" | "ADMIN_DOMAIN">,
  params: {
    spaceId: string;
    serviceId: string;
  },
): Promise<Array<{ name: string; value: string; secret: boolean }>> {
  const consumerGroupId = await getServiceGroupId(
    env,
    params.spaceId,
    params.serviceId,
  );
  const rows = await listServiceConsumeRows(
    env,
    params.spaceId,
    params.serviceId,
  );
  const out = new Map<string, { value: string; secret: boolean }>();

  for (const row of rows) {
    const consume = parseConsumeConfig(row);
    const publication = await resolveConsumePublicationDefinition(env, {
      spaceId: params.spaceId,
      consume,
      consumerGroupId,
    });
    if (!publication) {
      throw new Error(
        `consume references unknown publication: ${consume.publication}`,
      );
    }
    const contract = publication.outputs;
    assertConsumeOutputAliases(consume, contract);
    const values = await resolvePublicationOutputValues(env, {
      spaceId: params.spaceId,
      serviceId: params.serviceId,
      publication: {
        id: "",
        name: publication.publication.name,
        sourceType: "api",
        groupId: publication.record?.groupId ?? null,
        ownerServiceId: null,
        catalogName: null,
        publicationType: publication.publication.type,
        publication: publication.publication,
        outputs: publication.outputs,
        resolved: publication.record?.resolved ?? {},
        createdAt: "",
        updatedAt: "",
      },
      consumeRow: row,
    });
    for (const output of selectedConsumeOutputs(consume, contract)) {
      const resolved = values[output.name];
      if (!resolved) {
        throw new Error(
          `publication '${consume.publication}' did not resolve output '${output.name}'`,
        );
      }
      const envName = resolveConsumeOutputEnvName(consume, output);
      if (out.has(envName)) {
        throw new Error(
          `multiple consumes resolve to the same environment variable: ${envName}`,
        );
      }
      out.set(envName, resolved);
    }
  }

  return Array.from(out.entries()).map(([name, value]) => ({
    name,
    value: value.value,
    secret: value.secret,
  }));
}
