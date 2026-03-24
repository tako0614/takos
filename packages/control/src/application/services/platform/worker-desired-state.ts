import type { Env } from '../../../shared/types';

type DesiredStateEnv = Pick<Env, 'DB' | 'ENCRYPTION_KEY' | 'ADMIN_DOMAIN'>;
import { generateId, now, safeJsonParseOrDefault } from '../../../shared/utils';
import { decrypt, encrypt, type EncryptedData } from '../../../shared/utils/crypto';
import type { WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';
import type { RoutingTarget } from '../routing/types';
import {
  CommonEnvRepository,
  type ReconcileUpdate,
  type ServiceLinkRow,
} from '../common-env/repository';
import {
  createBindingFingerprint,
  decryptCommonEnvValue,
  normalizeEnvName,
} from '../common-env/crypto';
import {
  ensureManagedTakosTokenValue,
  resolveTakosApiUrl,
  TAKOS_ACCESS_TOKEN_ENV_NAME,
  TAKOS_API_URL_ENV_NAME,
} from '../common-env/takos-builtins';
import {
  getDb,
  serviceRuntimeSettings,
  serviceRuntimeFlags,
  serviceRuntimeLimits,
  serviceMcpEndpoints,
  serviceEnvVars,
  resources,
  deployments,
  serviceDeployments,
} from '../../../infra/db';
import { serviceBindings, physicalServiceBindings } from '../../../infra/db/schema-services';
import { eq, and, desc, inArray, isNotNull, gt, sql } from 'drizzle-orm';
import { getDeploymentRouteHead } from '../deployment/store';

type ServiceRuntimeLimits = {
  cpu_ms?: number;
  subrequests?: number;
};

export type ServiceManagedMcpServerState = {
  enabled: boolean;
  name: string;
  path: string;
};

export type ServiceRuntimeConfigState = {
  compatibility_date?: string;
  compatibility_flags: string[];
  limits: ServiceRuntimeLimits;
  mcp_server?: ServiceManagedMcpServerState;
  updated_at: string | null;
};

export type ServiceLocalEnvVarState = {
  name: string;
  value: string;
  secret: boolean;
  updated_at: string;
};

export type ServiceLocalEnvVarSummary = {
  name: string;
  type: 'plain_text' | 'secret_text';
  value: string;
  updated_at: string;
};

export type ServiceDesiredStateSnapshot = {
  envVars: Record<string, string>;
  envBindings: WorkerBinding[];
  resourceBindings: WorkerBinding[];
  bindings: WorkerBinding[];
  runtimeConfig: ServiceRuntimeConfigState;
  commonEnvUpdates: ReconcileUpdate[];
};

type ServiceEnvRow = {
  id: string;
  serviceId: string;
  accountId: string;
  name: string;
  valueEncrypted: string;
  isSecret: boolean;
  updatedAt: string;
};

type ServiceRuntimeRow = {
  compatibilityDate: string | null;
  updatedAt: string;
};

type ServiceRuntimeFlagRow = {
  flag: string;
};

type ServiceRuntimeLimitRow = {
  cpuMs: number | null;
  memoryMb: number | null;
  subrequestLimit: number | null;
};

type ServiceRuntimeMcpEndpointRow = {
  name: string;
  path: string;
  enabled: boolean;
};

type ServiceBindingRow = {
  id: string;
  bindingName: string;
  bindingType: string;
  config: string;
  resourceId: string;
  resourceName: string | null;
  resourceType: string;
  resourceStatus: string;
  resourceCfId: string | null;
  resourceCfName: string | null;
};

type RoutingRow = {
  id: string;
  artifactRef: string | null;
  routingStatus: string;
  routingWeight: number | string;
};

type EffectiveCommonEnvLink = {
  rowId: string;
  envName: string;
  source: 'manual' | 'required';
  lastAppliedFingerprint: string | null;
};

type CommonEnvValue = {
  value: string;
  isSecret: boolean;
};

const MASKED_SECRET_VALUE = '********';

function requireEncryptionKey(env: DesiredStateEnv): string {
  const key = env.ENCRYPTION_KEY || '';
  if (!key) {
    throw new Error('ENCRYPTION_KEY must be set');
  }
  return key;
}

function buildServiceEnvSalt(serviceId: string, envName: string): string {
  return `service-env:${serviceId}:${normalizeEnvName(envName)}`;
}

function normalizeLimits(input?: ServiceRuntimeLimits | null): ServiceRuntimeLimits {
  const limits: ServiceRuntimeLimits = {};
  if (!input) return limits;

  if (typeof input.cpu_ms === 'number' && Number.isFinite(input.cpu_ms)) {
    limits.cpu_ms = Math.floor(input.cpu_ms);
  }
  if (typeof input.subrequests === 'number' && Number.isFinite(input.subrequests)) {
    limits.subrequests = Math.floor(input.subrequests);
  }

  return limits;
}

function parseRuntimeRow(
  row: ServiceRuntimeRow | null,
  flags: ServiceRuntimeFlagRow[],
  limitsRow: ServiceRuntimeLimitRow | null,
  mcpEndpoints: ServiceRuntimeMcpEndpointRow[]
): ServiceRuntimeConfigState {
  if (!row) {
    return {
      compatibility_flags: [],
      limits: {},
      updated_at: null,
    };
  }

  const enabledEndpoint = mcpEndpoints.find((endpoint) => endpoint.enabled) || mcpEndpoints[0];

  return {
    compatibility_date: row.compatibilityDate || undefined,
    compatibility_flags: flags.map((flag) => flag.flag),
    limits: normalizeLimits({
      cpu_ms: limitsRow?.cpuMs ?? undefined,
      subrequests: limitsRow?.subrequestLimit ?? undefined,
    }),
    mcp_server: enabledEndpoint
      ? {
          enabled: enabledEndpoint.enabled,
          name: enabledEndpoint.name,
          path: enabledEndpoint.path,
        }
      : undefined,
    updated_at: row.updatedAt,
  };
}

function getEffectiveLinks(rows: ServiceLinkRow[]): Map<string, EffectiveCommonEnvLink> {
  const grouped = new Map<string, { manual?: ServiceLinkRow; required?: ServiceLinkRow }>();

  for (const row of rows) {
    const key = normalizeEnvName(row.env_name);
    const bucket = grouped.get(key) || {};
    if (row.source === 'manual') bucket.manual = row;
    if (row.source === 'required') bucket.required = row;
    grouped.set(key, bucket);
  }

  const out = new Map<string, EffectiveCommonEnvLink>();
  for (const [envName, bucket] of grouped.entries()) {
    const selected = bucket.manual || bucket.required;
    if (!selected) continue;
    out.set(envName, {
      rowId: selected.id,
      envName,
      source: selected.source,
      lastAppliedFingerprint: selected.last_applied_fingerprint,
    });
  }

  return out;
}

function sortBindings(bindings: WorkerBinding[]): WorkerBinding[] {
  return [...bindings].sort((a, b) => {
    const typeCompare = a.type.localeCompare(b.type);
    if (typeCompare !== 0) return typeCompare;
    return a.name.localeCompare(b.name);
  });
}

function normalizeRoutingWeight(raw: number | string): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return 0;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : 0;
}

function parseBindingConfig(config: string): Record<string, unknown> {
  return safeJsonParseOrDefault<Record<string, unknown>>(config, {});
}

function toServiceBinding(row: ServiceBindingRow): WorkerBinding | null {
  const config = parseBindingConfig(row.config);

  switch (row.bindingType) {
    case 'd1':
      if (!row.resourceCfId) return null;
      return {
        type: 'd1',
        name: row.bindingName,
        database_id: row.resourceCfId,
      };
    case 'r2':
      if (!row.resourceCfName) return null;
      return {
        type: 'r2_bucket',
        name: row.bindingName,
        bucket_name: row.resourceCfName,
      };
    case 'kv':
      if (!row.resourceCfId) return null;
      return {
        type: 'kv_namespace',
        name: row.bindingName,
        namespace_id: row.resourceCfId,
      };
    case 'service':
      return {
        type: 'service',
        name: row.bindingName,
        service: row.resourceCfName || row.resourceCfId || undefined,
        environment: typeof config.environment === 'string' ? config.environment : undefined,
      };
    default:
      return null;
  }
}

async function decryptServiceEnvRow(
  encryptionKey: string,
  row: ServiceEnvRow
): Promise<ServiceLocalEnvVarState> {
  const encrypted = JSON.parse(row.valueEncrypted) as EncryptedData;
  const value = await decrypt(encrypted, encryptionKey, buildServiceEnvSalt(row.serviceId, row.name));
  return {
    name: normalizeEnvName(row.name),
    value,
    secret: row.isSecret,
    updated_at: row.updatedAt,
  };
}

async function loadWorkspaceCommonEnvMap(
  env: DesiredStateEnv,
  repo: CommonEnvRepository,
  spaceId: string
): Promise<Map<string, CommonEnvValue>> {
  const rows = await repo.listWorkspaceEnvRows(spaceId);
  const out = new Map<string, CommonEnvValue>();

  for (const row of rows) {
    const key = normalizeEnvName(row.name);
    if (out.has(key)) {
      throw new Error(`Conflicting common env entries exist for key: ${key}`);
    }
    out.set(key, {
      value: await decryptCommonEnvValue(env, row),
      isSecret: row.is_secret,
    });
  }

  return out;
}

async function resolveManagedCommonEnvValue(
  env: DesiredStateEnv,
  spaceId: string,
  serviceId: string,
  envName: string,
): Promise<CommonEnvValue | null> {
  if (envName === TAKOS_API_URL_ENV_NAME) {
    const value = resolveTakosApiUrl(env);
    if (!value) return null;
    return { value, isSecret: false };
  }

  if (envName === TAKOS_ACCESS_TOKEN_ENV_NAME) {
    const resolved = await ensureManagedTakosTokenValue({
      env,
      spaceId,
      workerId: serviceId,
      envName,
    });
    if (!resolved) return null;
    return { value: resolved.value, isSecret: true };
  }

  return null;
}

export async function resolveServiceCommonEnvState(
  env: DesiredStateEnv,
  spaceId: string,
  serviceId: string
): Promise<{
  envBindings: WorkerBinding[];
  envVars: Record<string, string>;
  localEnvVars: ServiceLocalEnvVarState[];
  commonEnvUpdates: ReconcileUpdate[];
}> {
  const encryptionKey = requireEncryptionKey(env);
  const repo = new CommonEnvRepository(env);
  const db = getDb(env.DB);

  const envRows = await db.select({
    id: serviceEnvVars.id,
    serviceId: serviceEnvVars.serviceId,
    accountId: serviceEnvVars.accountId,
    name: serviceEnvVars.name,
    valueEncrypted: serviceEnvVars.valueEncrypted,
    isSecret: serviceEnvVars.isSecret,
    updatedAt: serviceEnvVars.updatedAt,
  })
    .from(serviceEnvVars)
    .where(and(
      eq(serviceEnvVars.accountId, spaceId),
      eq(serviceEnvVars.serviceId, serviceId),
    ))
    .orderBy(desc(serviceEnvVars.updatedAt), serviceEnvVars.name)
    .all();

  const localEnvVars = await Promise.all(
    envRows.map((row) => decryptServiceEnvRow(encryptionKey, row as ServiceEnvRow))
  );

  const localMap = new Map<string, ServiceLocalEnvVarState>();
  for (const row of localEnvVars) {
    localMap.set(row.name, row);
  }

  const envBindingMap = new Map<string, WorkerBinding>();
  for (const row of localEnvVars) {
    envBindingMap.set(row.name, {
      type: row.secret ? 'secret_text' : 'plain_text',
      name: row.name,
      text: row.value,
    });
  }

  const linkRows = await repo.listServiceLinks(spaceId, serviceId);
  const commonMap = await loadWorkspaceCommonEnvMap(env, repo, spaceId);
  const effectiveLinks = getEffectiveLinks(linkRows);
  const updates: ReconcileUpdate[] = [];

  for (const [key, link] of effectiveLinks.entries()) {
    const common = commonMap.get(key) || await resolveManagedCommonEnvValue(env, spaceId, serviceId, key);
    const local = localMap.get(key);

    if (!common) {
      updates.push({
        rowId: link.rowId,
        syncState: 'missing_builtin',
        syncReason: 'common_deleted',
        lastSyncError: null,
      });
      continue;
    }

    const desiredBinding: {
      type: 'plain_text' | 'secret_text';
      name: string;
      text: string;
    } = {
      type: common.isSecret ? 'secret_text' : 'plain_text',
      name: key,
      text: common.value,
    };
    const desiredFingerprint = await createBindingFingerprint({
      env,
      spaceId,
      envName: key,
      type: desiredBinding.type,
      text: desiredBinding.text,
    });

    if (link.source === 'manual') {
      envBindingMap.set(key, desiredBinding);
      updates.push({
        rowId: link.rowId,
        lastAppliedFingerprint: desiredFingerprint,
        lastObservedFingerprint: desiredFingerprint,
        syncState: 'managed',
        syncReason: 'link_created',
        lastSyncError: null,
      });
      continue;
    }

    if (local) {
      const localFingerprint = await createBindingFingerprint({
        env,
        spaceId,
        envName: key,
        type: local.secret ? 'secret_text' : 'plain_text',
        text: local.value,
      });
      updates.push({
        rowId: link.rowId,
        lastAppliedFingerprint: link.lastAppliedFingerprint ?? desiredFingerprint,
        lastObservedFingerprint: localFingerprint,
        syncState: 'overridden',
        syncReason: 'user_override',
        lastSyncError: null,
      });
      continue;
    }

    envBindingMap.set(key, desiredBinding);
    updates.push({
      rowId: link.rowId,
      lastAppliedFingerprint: desiredFingerprint,
      lastObservedFingerprint: desiredFingerprint,
      syncState: 'managed',
      syncReason: 'common_restored',
      lastSyncError: null,
    });
  }

  const envBindings = sortBindings(Array.from(envBindingMap.values()));
  const envVars: Record<string, string> = {};
  for (const binding of envBindings) {
    if (binding.type === 'plain_text' || binding.type === 'secret_text') {
      envVars[binding.name] = binding.text ?? '';
    }
  }

  return {
    envBindings,
    envVars,
    localEnvVars,
    commonEnvUpdates: updates,
  };
}

export class ServiceDesiredStateService {
  private readonly encryptionKey: string;

  constructor(private readonly env: DesiredStateEnv) {
    this.encryptionKey = requireEncryptionKey(env);
  }

  private get db() {
    return getDb(this.env.DB);
  }

  async getRuntimeConfig(spaceId: string, serviceId: string): Promise<ServiceRuntimeConfigState> {
    const [row, flagRows, limitsRow, mcpRows] = await Promise.all([
      this.db.select({
        compatibilityDate: serviceRuntimeSettings.compatibilityDate,
        updatedAt: serviceRuntimeSettings.updatedAt,
      })
        .from(serviceRuntimeSettings)
        .where(and(
          eq(serviceRuntimeSettings.accountId, spaceId),
          eq(serviceRuntimeSettings.serviceId, serviceId),
        ))
        .get(),

      this.db.select({ flag: serviceRuntimeFlags.flag })
        .from(serviceRuntimeFlags)
        .where(eq(serviceRuntimeFlags.serviceId, serviceId))
        .orderBy(serviceRuntimeFlags.flag)
        .all(),

      this.db.select({
        cpuMs: serviceRuntimeLimits.cpuMs,
        memoryMb: serviceRuntimeLimits.memoryMb,
        subrequestLimit: serviceRuntimeLimits.subrequestLimit,
      })
        .from(serviceRuntimeLimits)
        .where(eq(serviceRuntimeLimits.serviceId, serviceId))
        .get(),

      this.db.select({
        name: serviceMcpEndpoints.name,
        path: serviceMcpEndpoints.path,
        enabled: serviceMcpEndpoints.enabled,
      })
        .from(serviceMcpEndpoints)
        .where(eq(serviceMcpEndpoints.serviceId, serviceId))
        .orderBy(serviceMcpEndpoints.name)
        .all(),
    ]);

    return parseRuntimeRow(
      (row as ServiceRuntimeRow) || null,
      flagRows as ServiceRuntimeFlagRow[],
      (limitsRow as ServiceRuntimeLimitRow) || null,
      mcpRows as ServiceRuntimeMcpEndpointRow[]
    );
  }

  async saveRuntimeConfig(params: {
    spaceId: string;
    serviceId?: string;
    workerId?: string;
    compatibilityDate?: string;
    compatibilityFlags?: string[];
    limits?: ServiceRuntimeLimits;
    mcpServer?: ServiceManagedMcpServerState;
  }): Promise<ServiceRuntimeConfigState> {
    const serviceId = params.serviceId ?? params.workerId;
    if (!serviceId) {
      throw new Error('Service runtime config requires a service identifier');
    }
    const timestamp = now();
    const compatibilityFlags = Array.from(new Set((params.compatibilityFlags || []).filter((flag) => typeof flag === 'string' && flag.trim().length > 0)));
    const limits = normalizeLimits(params.limits);

    // Upsert runtime settings
    await this.db.insert(serviceRuntimeSettings)
      .values({
        serviceId,
        accountId: params.spaceId,
        compatibilityDate: params.compatibilityDate || null,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .onConflictDoUpdate({
        target: serviceRuntimeSettings.serviceId,
        set: {
          compatibilityDate: params.compatibilityDate || null,
          updatedAt: timestamp,
        },
      });

    // Replace flags: delete all then insert
    await this.db.delete(serviceRuntimeFlags)
      .where(eq(serviceRuntimeFlags.serviceId, serviceId));

    if (compatibilityFlags.length > 0) {
      await this.db.insert(serviceRuntimeFlags)
        .values(compatibilityFlags.map((flag) => ({
          serviceId,
          flag,
        })));
    }

    // Replace limits: delete all then insert
    await this.db.delete(serviceRuntimeLimits)
      .where(eq(serviceRuntimeLimits.serviceId, serviceId));

    if (limits.cpu_ms !== undefined || limits.subrequests !== undefined) {
      await this.db.insert(serviceRuntimeLimits)
        .values({
          serviceId,
          cpuMs: limits.cpu_ms ?? null,
          memoryMb: null,
          subrequestLimit: limits.subrequests ?? null,
        });
    }

    // Replace MCP endpoints: delete all then insert
    await this.db.delete(serviceMcpEndpoints)
      .where(eq(serviceMcpEndpoints.serviceId, serviceId));

    if (params.mcpServer) {
      await this.db.insert(serviceMcpEndpoints)
        .values({
          serviceId,
          name: params.mcpServer.name,
          path: params.mcpServer.path,
          enabled: !!params.mcpServer.enabled,
        });
    }

    return this.getRuntimeConfig(params.spaceId, serviceId);
  }

  async listLocalEnvVars(spaceId: string, serviceId: string): Promise<ServiceLocalEnvVarState[]> {
    const resolved = await resolveServiceCommonEnvState(this.env, spaceId, serviceId);
    return resolved.localEnvVars.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listLocalEnvVarSummaries(spaceId: string, serviceId: string): Promise<ServiceLocalEnvVarSummary[]> {
    const vars = await this.listLocalEnvVars(spaceId, serviceId);
    return vars.map((row) => ({
      name: row.name,
      type: row.secret ? 'secret_text' : 'plain_text',
      value: row.secret ? '********' : row.value,
      updated_at: row.updated_at,
    }));
  }

  async replaceLocalEnvVars(params: {
    spaceId: string;
    serviceId?: string;
    workerId?: string;
    variables: Array<{ name: string; value: string; secret?: boolean }>;
  }): Promise<void> {
    const serviceId = params.serviceId ?? params.workerId;
    if (!serviceId) {
      throw new Error('Local env replacement requires a service identifier');
    }
    const existingVars = await this.listLocalEnvVars(params.spaceId, serviceId);
    const existingMap = new Map(existingVars.map((row) => [row.name, row]));
    const deduped = new Map<string, { value: string; secret: boolean }>();
    for (const variable of params.variables) {
      const name = normalizeEnvName(variable.name);
      const existing = existingMap.get(name);
      const shouldPreserveSecret =
        variable.secret === true
        && variable.value === MASKED_SECRET_VALUE
        && existing?.secret === true;
      deduped.set(name, {
        value: shouldPreserveSecret ? existing.value : String(variable.value ?? ''),
        secret: variable.secret === true,
      });
    }

    // Encrypt all values first (before entering the transaction) since
    // encryption is async and we want to minimise time inside the transaction.
    const timestamp = now();
    const encrypted: Array<{
      name: string;
      valueEncrypted: string;
      isSecret: boolean;
    }> = [];
    for (const [name, variable] of deduped.entries()) {
      const enc = await encrypt(
        variable.value,
        this.encryptionKey,
        buildServiceEnvSalt(serviceId, name)
      );
      encrypted.push({
        name,
        valueEncrypted: JSON.stringify(enc),
        isSecret: variable.secret,
      });
    }

    // Use raw BEGIN/COMMIT for transactional atomicity since D1 Drizzle
    // doesn't support .transaction(). Individual statements inside are
    // Drizzle query-builder calls.
    await this.env.DB.prepare('BEGIN IMMEDIATE').run();
    try {
      await this.db.delete(serviceEnvVars)
        .where(and(
          eq(serviceEnvVars.accountId, params.spaceId),
          eq(serviceEnvVars.serviceId, serviceId),
        ));

      if (encrypted.length > 0) {
        await this.db.insert(serviceEnvVars)
          .values(encrypted.map((row) => ({
            id: generateId(),
            serviceId,
            accountId: params.spaceId,
            name: row.name,
            valueEncrypted: row.valueEncrypted,
            isSecret: !!row.isSecret,
            createdAt: timestamp,
            updatedAt: timestamp,
          })));
      }

      await this.env.DB.prepare('COMMIT').run();
    } catch (error) {
      try {
        await this.env.DB.prepare('ROLLBACK').run();
      } catch {
        // Ignore rollback failures and rethrow the original error.
      }
      throw error;
    }
  }

  async listResourceBindings(serviceId: string): Promise<Array<{
    id: string;
    name: string;
    type: string;
    resource_id: string;
    resource_name: string | null;
  }>> {
    const rows = await this.db.select({
      id: serviceBindings.id,
      bindingName: serviceBindings.bindingName,
      bindingType: serviceBindings.bindingType,
      resourceId: serviceBindings.resourceId,
      resourceName: resources.name,
    })
      .from(serviceBindings)
      .innerJoin(resources, eq(resources.id, serviceBindings.resourceId))
      .where(eq(serviceBindings.serviceId, serviceId))
      .orderBy(serviceBindings.bindingName)
      .all();

    return rows.map((row) => ({
      id: row.id,
      name: row.bindingName,
      type: row.bindingType === 'r2' ? 'r2_bucket' : row.bindingType === 'kv' ? 'kv_namespace' : row.bindingType,
      resource_id: row.resourceId,
      resource_name: row.resourceName,
    }));
  }

  async replaceResourceBindings(params: {
    serviceId?: string;
    workerId?: string;
    bindings: Array<{ name: string; type: string; resourceId: string; config?: Record<string, unknown> }>;
  }): Promise<void> {
    const serviceId = params.serviceId ?? params.workerId;
    if (!serviceId) {
      throw new Error('Resource binding replacement requires a service identifier');
    }
    const timestamp = now();

    await this.env.DB.prepare('BEGIN IMMEDIATE').run();
    try {
      await this.db.delete(physicalServiceBindings)
        .where(eq(physicalServiceBindings.serviceId, serviceId));

      if (params.bindings.length > 0) {
        await this.db.insert(physicalServiceBindings)
          .values(params.bindings.map((binding) => ({
            id: generateId(),
            serviceId,
            resourceId: binding.resourceId,
            bindingName: binding.name,
            bindingType: binding.type,
            config: JSON.stringify(binding.config || {}),
            createdAt: timestamp,
          })));
      }

      await this.env.DB.prepare('COMMIT').run();
    } catch (error) {
      try {
        await this.env.DB.prepare('ROLLBACK').run();
      } catch {
        // Ignore rollback failures and rethrow the original error.
      }
      throw error;
    }
  }

  async resolveDeploymentState(spaceId: string, serviceId: string): Promise<ServiceDesiredStateSnapshot> {
    const [runtimeConfig, commonEnvState, resourceRows] = await Promise.all([
      this.getRuntimeConfig(spaceId, serviceId),
      resolveServiceCommonEnvState(this.env, spaceId, serviceId),
      this.db.select({
        id: serviceBindings.id,
        bindingName: serviceBindings.bindingName,
        bindingType: serviceBindings.bindingType,
        config: serviceBindings.config,
        resourceId: serviceBindings.resourceId,
        resourceName: resources.name,
        resourceType: resources.type,
        resourceStatus: resources.status,
        resourceCfId: resources.cfId,
        resourceCfName: resources.cfName,
      })
        .from(serviceBindings)
        .innerJoin(resources, eq(resources.id, serviceBindings.resourceId))
        .where(eq(serviceBindings.serviceId, serviceId))
        .orderBy(serviceBindings.bindingName)
        .all(),
    ]);

    const resourceBindings: WorkerBinding[] = [];
    for (const row of resourceRows) {
      if (row.resourceStatus !== 'active') {
        throw new Error(`Bound resource is not active: ${row.resourceName || row.resourceId}`);
      }

      const binding = toServiceBinding(row as ServiceBindingRow);
      if (!binding) {
        throw new Error(`Unsupported or incomplete service binding: ${row.bindingName}`);
      }
      resourceBindings.push(binding);
    }

    const bindings = sortBindings([...resourceBindings, ...commonEnvState.envBindings]);

    return {
      envVars: commonEnvState.envVars,
      envBindings: commonEnvState.envBindings,
      resourceBindings,
      bindings,
      runtimeConfig,
      commonEnvUpdates: commonEnvState.commonEnvUpdates,
    };
  }

  async getCurrentDeploymentArtifactRef(serviceId: string): Promise<string | null> {
    const routeHead = await getDeploymentRouteHead(this.env.DB, serviceId);
    if (!routeHead.exists || !routeHead.activeDeploymentId) {
      return null;
    }

    const row = await this.db.select({
      artifactRef: deployments.artifactRef,
    })
      .from(deployments)
      .where(eq(deployments.id, routeHead.activeDeploymentId))
      .get();

    return row?.artifactRef || null;
  }

  async getRoutingTarget(serviceId: string): Promise<RoutingTarget | null> {
    // The ORDER BY uses a CASE expression for routing_status priority that
    // can't be expressed cleanly through the Drizzle query builder, so we
    // use sql`` for the ordering clause.
    const rows = await this.db.select({
      id: deployments.id,
      artifactRef: deployments.artifactRef,
      routingStatus: deployments.routingStatus,
      routingWeight: deployments.routingWeight,
    })
      .from(deployments)
      .where(and(
        eq(serviceDeployments.serviceId, serviceId),
        isNotNull(deployments.artifactRef),
        inArray(deployments.routingStatus, ['active', 'canary', 'rollback']),
        gt(deployments.routingWeight, 0),
      ))
      .orderBy(
        sql`CASE ${deployments.routingStatus}
          WHEN 'rollback' THEN 0
          WHEN 'active' THEN 1
          WHEN 'canary' THEN 2
          ELSE 3
        END ASC`,
        desc(deployments.version),
      )
      .all();

    const deploys = rows
      .map((row) => ({
        routeRef: row.artifactRef || '',
        weight: normalizeRoutingWeight(row.routingWeight),
        deploymentId: row.id,
        status: row.routingStatus as 'active' | 'canary' | 'rollback',
      }))
      .filter((row) => row.routeRef && row.weight > 0);

    if (deploys.length > 0) {
      return {
        type: 'deployments',
        deployments: deploys,
      };
    }

    const fallbackArtifactRef = await this.getCurrentDeploymentArtifactRef(serviceId);
    if (!fallbackArtifactRef) {
      return null;
    }

    return {
      type: 'deployments',
      deployments: [
        {
          routeRef: fallbackArtifactRef,
          weight: 100,
          status: 'active',
        },
      ],
    };
  }
}

export function createServiceDesiredStateService(env: DesiredStateEnv): ServiceDesiredStateService {
  return new ServiceDesiredStateService(env);
}

export type WorkerManagedMcpServerState = ServiceManagedMcpServerState;
export type WorkerRuntimeConfigState = ServiceRuntimeConfigState;
export type WorkerLocalEnvVarState = ServiceLocalEnvVarState;
export type WorkerLocalEnvVarSummary = ServiceLocalEnvVarSummary;
export type WorkerDesiredStateSnapshot = ServiceDesiredStateSnapshot;
export { ServiceDesiredStateService as WorkerDesiredStateService };
export { resolveServiceCommonEnvState as resolveWorkerCommonEnvState };
export { createServiceDesiredStateService as createWorkerDesiredStateService };
