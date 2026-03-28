import { BadRequestError } from 'takos-common/errors';
import { generateId, now } from '../../../shared/utils';
import type { WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';
import type { RoutingTarget } from '../routing/types';
import { normalizeEnvName } from '../common-env/crypto';
import { encrypt } from '../../../shared/utils/crypto';
import {
  getDb,
  serviceEnvVars,
  resources,
  deployments,
  serviceDeployments,
} from '../../../infra/db';
import { serviceBindings, physicalServiceBindings } from '../../../infra/db/schema-services';
import { eq, and, desc, inArray, isNotNull, gt, sql } from 'drizzle-orm';
import { getDeploymentRouteHead } from '../deployment/store';

// Re-export types from the types module
export type {
  ServiceManagedMcpServerState,
  ServiceRuntimeConfigState,
  ServiceLocalEnvVarState,
  ServiceLocalEnvVarSummary,
  ServiceDesiredStateSnapshot,
} from './desired-state-types';

import type {
  DesiredStateEnv,
  ServiceManagedMcpServerState,
  ServiceRuntimeConfigState,
  ServiceRuntimeLimits,
  ServiceBindingRow,
  ServiceLocalEnvVarState,
  ServiceLocalEnvVarSummary,
  ServiceDesiredStateSnapshot,
} from './desired-state-types';
import { MASKED_SECRET_VALUE } from './desired-state-types';

import {
  sortBindings,
  normalizeRoutingWeight,
  toServiceBinding,
} from './resource-bindings';

import {
  requireEncryptionKey,
  buildServiceEnvSalt,
  resolveServiceCommonEnvState,
} from './env-state-resolution';

import {
  getRuntimeConfig,
  saveRuntimeConfig,
} from './runtime-config';

// Re-export resolveServiceCommonEnvState for external consumers
export { resolveServiceCommonEnvState } from './env-state-resolution';

export class ServiceDesiredStateService {
  private readonly encryptionKey: string;

  constructor(private readonly env: DesiredStateEnv) {
    this.encryptionKey = requireEncryptionKey(env);
  }

  private get db() {
    return getDb(this.env.DB);
  }

  async getRuntimeConfig(spaceId: string, serviceId: string): Promise<ServiceRuntimeConfigState> {
    return getRuntimeConfig(this.env, spaceId, serviceId);
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
    return saveRuntimeConfig(this.env, params);
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
      throw new BadRequestError('Local env replacement requires a service identifier');
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
      type: row.bindingType === 'r2'
        ? 'r2_bucket'
        : row.bindingType === 'kv'
          ? 'kv_namespace'
          : row.bindingType === 'analytics_engine'
            ? 'analytics_engine'
          : row.bindingType,
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
      throw new BadRequestError('Resource binding replacement requires a service identifier');
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
        throw new BadRequestError(`Bound resource is not active: ${row.resourceName || row.resourceId}`);
      }

      const binding = toServiceBinding(row as ServiceBindingRow);
      if (!binding) {
        throw new BadRequestError(`Unsupported or incomplete service binding: ${row.bindingName}`);
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

// Legacy aliases for backward compatibility
export type WorkerManagedMcpServerState = import('./desired-state-types').ServiceManagedMcpServerState;
export type WorkerRuntimeConfigState = import('./desired-state-types').ServiceRuntimeConfigState;
export type WorkerLocalEnvVarState = import('./desired-state-types').ServiceLocalEnvVarState;
export type WorkerLocalEnvVarSummary = import('./desired-state-types').ServiceLocalEnvVarSummary;
export type WorkerDesiredStateSnapshot = import('./desired-state-types').ServiceDesiredStateSnapshot;
export { ServiceDesiredStateService as WorkerDesiredStateService };
export { resolveServiceCommonEnvState as resolveWorkerCommonEnvState };
export { createServiceDesiredStateService as createWorkerDesiredStateService };
