import { BadRequestError } from "@takos/worker-platform-utils/errors";
import { generateId } from "../../../shared/utils/index.ts";
import type { RoutingTarget } from "../routing/routing-models.ts";
import { encrypt } from "../../../shared/utils/crypto.ts";
import {
  deployments,
  getDb,
  resources,
  serviceDeployments,
  serviceEnvVars,
} from "../../../infra/db/index.ts";
import {
  physicalServiceBindings,
  serviceBindings,
} from "../../../infra/db/schema-services.ts";
import { and, desc, eq, gt, inArray, isNotNull, sql } from "drizzle-orm";
import { getDeploymentRouteHead } from "../deployment/store.ts";
import type { ActiveRoutingStatus } from "../deployment/models.ts";

// Re-export types from the types module
export type {
  ServiceBindingSpec,
  ServiceDesiredStateSnapshot,
  ServiceLocalEnvVarState,
  ServiceLocalEnvVarSummary,
  ServiceRuntimeConfigState,
} from "./desired-state-types.ts";

import type {
  DesiredStateEnv,
  ServiceBindingSpec,
  ServiceDesiredStateSnapshot,
  ServiceLocalEnvVarState,
  ServiceLocalEnvVarSummary,
  ServiceRuntimeConfigState,
  ServiceRuntimeLimits,
} from "./desired-state-types.ts";
import { MASKED_SECRET_VALUE } from "./desired-state-types.ts";

import {
  normalizeRoutingWeight,
  sortBindings,
  toRuntimeBindingType,
  toServiceBinding,
} from "./resource-bindings.ts";

import {
  buildServiceEnvSalt,
  decryptServiceEnvRow,
  requireEncryptionKey,
  resolveServiceCommonEnvState,
} from "./env-state-resolution.ts";

import { getRuntimeConfig, saveRuntimeConfig } from "./runtime-config.ts";
import { getPortableSecretValue } from "../resources/portable-runtime.ts";
import { decryptResourceSecretValue } from "../resources/secret-crypto.ts";
import { normalizeEnvName } from "../common-env/crypto.ts";

// Re-export resolveServiceCommonEnvState for external consumers
export { resolveServiceCommonEnvState } from "./env-state-resolution.ts";

export class ServiceDesiredStateService {
  private readonly encryptionKey: string;

  constructor(private readonly env: DesiredStateEnv) {
    this.encryptionKey = requireEncryptionKey(env);
  }

  private get db() {
    return getDb(this.env.DB);
  }

  async getRuntimeConfig(
    spaceId: string,
    serviceId: string,
  ): Promise<ServiceRuntimeConfigState> {
    return getRuntimeConfig(this.env, spaceId, serviceId);
  }

  async saveRuntimeConfig(params: {
    spaceId: string;
    serviceId?: string;
    workerId?: string;
    compatibilityDate?: string;
    compatibilityFlags?: string[];
    limits?: ServiceRuntimeLimits;
  }): Promise<ServiceRuntimeConfigState> {
    return saveRuntimeConfig(this.env, params);
  }

  async listLocalEnvVars(
    spaceId: string,
    serviceId: string,
  ): Promise<ServiceLocalEnvVarState[]> {
    const rows = await this.db.select({
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

    const vars = await Promise.all(
      rows.map((row) => decryptServiceEnvRow(this.encryptionKey, row)),
    );
    return vars.sort((a, b) => a.name.localeCompare(b.name));
  }

  async listLocalEnvVarSummaries(
    spaceId: string,
    serviceId: string,
  ): Promise<ServiceLocalEnvVarSummary[]> {
    const vars = await this.listLocalEnvVars(spaceId, serviceId);
    return vars.map((row) => ({
      name: row.name,
      type: row.secret ? "secret_text" : "plain_text",
      value: row.secret ? "********" : row.value,
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
      throw new BadRequestError(
        "Local env replacement requires a service identifier",
      );
    }
    const existingVars = await this.listLocalEnvVars(params.spaceId, serviceId);
    const existingMap = new Map(existingVars.map((row) => [row.name, row]));
    const deduped = new Map<string, { value: string; secret: boolean }>();
    for (const variable of params.variables) {
      const name = normalizeEnvName(variable.name);
      const existing = existingMap.get(name);
      const shouldPreserveSecret = variable.secret === true &&
        variable.value === MASKED_SECRET_VALUE &&
        existing?.secret === true;
      deduped.set(name, {
        value: shouldPreserveSecret
          ? existing.value
          : String(variable.value ?? ""),
        secret: variable.secret === true,
      });
    }

    // Encrypt all values first (before entering the transaction) since
    // encryption is async and we want to minimise time inside the transaction.
    const timestamp = new Date().toISOString();
    const encrypted: Array<{
      name: string;
      valueEncrypted: string;
      isSecret: boolean;
    }> = [];
    for (const [name, variable] of deduped.entries()) {
      const enc = await encrypt(
        variable.value,
        this.encryptionKey,
        buildServiceEnvSalt(serviceId, name),
      );
      encrypted.push({
        name,
        valueEncrypted: JSON.stringify(enc),
        isSecret: variable.secret,
      });
    }

    const replaceRows = async () => {
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
    };

    // Atomic delete+insert: a crash/failure between the two must not leave the
    // service with its env vars and secrets partially (or fully) wiped. This is
    // also the desired-state ROLLBACK primitive, so non-atomicity here could
    // turn a failed apply's recovery into permanent secret loss. Mirrors
    // replaceResourceBindings: prefer the binding's transaction, fall back to a
    // manual BEGIN/COMMIT where `withTransaction` is unavailable (real D1).
    if (typeof this.env.DB.withTransaction === "function") {
      await this.env.DB.withTransaction(() => replaceRows());
      return;
    }

    await this.env.DB.prepare("BEGIN IMMEDIATE").run();
    try {
      await replaceRows();
      await this.env.DB.prepare("COMMIT").run();
    } catch (error) {
      try {
        await this.env.DB.prepare("ROLLBACK").run();
      } catch {
        // Ignore rollback failures and rethrow the original error.
      }
      throw error;
    }
  }

  async listResourceBindings(serviceId: string): Promise<
    Array<{
      id: string;
      name: string;
      type: ServiceBindingSpec["type"];
      resource_id: string;
      resource_name: string | null;
    }>
  > {
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
      type: toRuntimeBindingType(row.bindingType) ?? "service",
      resource_id: row.resourceId,
      resource_name: row.resourceName,
    }));
  }

  private async resolveResourceBindings(
    serviceId: string,
  ): Promise<ServiceBindingSpec[]> {
    const rows = await this.db.select({
      id: serviceBindings.id,
      bindingName: serviceBindings.bindingName,
      bindingType: serviceBindings.bindingType,
      config: serviceBindings.config,
      resourceId: serviceBindings.resourceId,
      resourceName: resources.name,
      resourceType: resources.type,
      resourceStatus: resources.status,
      backendName: resources.backendName,
      backingResourceId: resources.backingResourceId,
      backingResourceName: resources.backingResourceName,
      resourceConfig: resources.config,
    })
      .from(serviceBindings)
      .innerJoin(resources, eq(resources.id, serviceBindings.resourceId))
      .where(and(
        eq(serviceBindings.serviceId, serviceId),
        eq(resources.status, "active"),
      ))
      .orderBy(serviceBindings.bindingName)
      .all();

    const bindings: ServiceBindingSpec[] = [];
    for (const row of rows) {
      let secretText: string | undefined;
      if (toRuntimeBindingType(row.bindingType) === "secret_text") {
        if (row.backendName && row.backendName !== "cloudflare") {
          secretText = await getPortableSecretValue({
            id: row.resourceId,
            backend_name: row.backendName,
            backing_resource_id: row.backingResourceId,
            backing_resource_name: row.backingResourceName,
            config: row.resourceConfig,
          });
        } else {
          // Cloudflare backend: the secret value lives (encrypted) in
          // backing_resource_id. Decrypt before it is injected as a runner
          // secret binding (legacy plaintext passes through unchanged).
          secretText = await decryptResourceSecretValue(
            this.env.ENCRYPTION_KEY,
            row.resourceId,
            row.backingResourceId ?? "",
          );
        }
      }

      const binding = toServiceBinding(row, { secretText });
      if (binding) bindings.push(binding);
    }
    return sortBindings(bindings);
  }

  async replaceResourceBindings(params: {
    serviceId?: string;
    workerId?: string;
    bindings: Array<{
      name: string;
      type: Exclude<ServiceBindingSpec["type"], "plain_text" | "secret_text">;
      resourceId: string;
      config?: Record<string, unknown>;
    }>;
  }): Promise<void> {
    const serviceId = params.serviceId ?? params.workerId;
    if (!serviceId) {
      throw new BadRequestError(
        "Resource binding replacement requires a service identifier",
      );
    }
    const timestamp = new Date().toISOString();

    const replaceRows = async () => {
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
    };

    // Prefer the binding's explicit transaction primitive (DQ1 fix): it runs the
    // whole unit on one dedicated connection under an exclusive gate, so no
    // concurrent query can leak into this BEGIN. Drizzle ops above close over the
    // same binding, so they are routed onto the transaction's dedicated client.
    // Real Cloudflare D1 does not implement `withTransaction`; fall back to the
    // manual BEGIN/COMMIT path there (non-composing against real D1, but
    // unchanged from prior behaviour).
    if (typeof this.env.DB.withTransaction === "function") {
      await this.env.DB.withTransaction(() => replaceRows());
      return;
    }

    await this.env.DB.prepare("BEGIN IMMEDIATE").run();
    try {
      await replaceRows();
      await this.env.DB.prepare("COMMIT").run();
    } catch (error) {
      try {
        await this.env.DB.prepare("ROLLBACK").run();
      } catch {
        // Ignore rollback failures and rethrow the original error.
      }
      throw error;
    }
  }

  async resolveDeploymentState(
    spaceId: string,
    serviceId: string,
  ): Promise<ServiceDesiredStateSnapshot> {
    const [runtimeConfig, commonEnvState, resourceBindings] = await Promise.all(
      [
        this.getRuntimeConfig(spaceId, serviceId),
        resolveServiceCommonEnvState(this.env, spaceId, serviceId),
        this.resolveResourceBindings(serviceId),
      ],
    );
    const bindings = sortBindings([
      ...commonEnvState.envBindings,
      ...resourceBindings,
    ]);

    return {
      envVars: commonEnvState.envVars,
      envBindings: commonEnvState.envBindings,
      resourceBindings,
      bindings,
      runtimeConfig,
      commonEnvUpdates: commonEnvState.commonEnvUpdates,
    };
  }

  async getCurrentDeploymentArtifactRef(
    serviceId: string,
  ): Promise<string | null> {
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
        inArray(deployments.routingStatus, ["active", "canary", "rollback"]),
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
        routeRef: row.artifactRef || "",
        weight: normalizeRoutingWeight(row.routingWeight),
        deploymentId: row.id,
        status: row.routingStatus as ActiveRoutingStatus,
      }))
      .filter((row) => row.routeRef && row.weight > 0);

    if (deploys.length > 0) {
      return {
        type: "deployments",
        deployments: deploys,
      };
    }

    const fallbackArtifactRef = await this.getCurrentDeploymentArtifactRef(
      serviceId,
    );
    if (!fallbackArtifactRef) {
      return null;
    }

    return {
      type: "deployments",
      deployments: [
        {
          routeRef: fallbackArtifactRef,
          weight: 100,
          status: "active",
        },
      ],
    };
  }
}
