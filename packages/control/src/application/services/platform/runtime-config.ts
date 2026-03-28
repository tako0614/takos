import { BadRequestError } from 'takos-common/errors';
import { now } from '../../../shared/utils';
import {
  getDb,
  serviceRuntimeSettings,
  serviceRuntimeFlags,
  serviceRuntimeLimits,
  serviceMcpEndpoints,
} from '../../../infra/db';
import { eq, and } from 'drizzle-orm';
import { normalizeLimits, parseRuntimeRow } from './resource-bindings';
import type {
  DesiredStateEnv,
  ServiceManagedMcpServerState,
  ServiceRuntimeConfigState,
  ServiceRuntimeLimits,
  ServiceRuntimeRow,
  ServiceRuntimeFlagRow,
  ServiceRuntimeLimitRow,
  ServiceRuntimeMcpEndpointRow,
} from './desired-state-types';

export async function getRuntimeConfig(
  env: DesiredStateEnv,
  spaceId: string,
  serviceId: string
): Promise<ServiceRuntimeConfigState> {
  const db = getDb(env.DB);

  const [row, flagRows, limitsRow, mcpRows] = await Promise.all([
    db.select({
      compatibilityDate: serviceRuntimeSettings.compatibilityDate,
      updatedAt: serviceRuntimeSettings.updatedAt,
    })
      .from(serviceRuntimeSettings)
      .where(and(
        eq(serviceRuntimeSettings.accountId, spaceId),
        eq(serviceRuntimeSettings.serviceId, serviceId),
      ))
      .get(),

    db.select({ flag: serviceRuntimeFlags.flag })
      .from(serviceRuntimeFlags)
      .where(eq(serviceRuntimeFlags.serviceId, serviceId))
      .orderBy(serviceRuntimeFlags.flag)
      .all(),

    db.select({
      cpuMs: serviceRuntimeLimits.cpuMs,
      memoryMb: serviceRuntimeLimits.memoryMb,
      subrequestLimit: serviceRuntimeLimits.subrequestLimit,
    })
      .from(serviceRuntimeLimits)
      .where(eq(serviceRuntimeLimits.serviceId, serviceId))
      .get(),

    db.select({
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

export async function saveRuntimeConfig(
  env: DesiredStateEnv,
  params: {
    spaceId: string;
    serviceId?: string;
    workerId?: string;
    compatibilityDate?: string;
    compatibilityFlags?: string[];
    limits?: ServiceRuntimeLimits;
    mcpServer?: ServiceManagedMcpServerState;
  }
): Promise<ServiceRuntimeConfigState> {
  const db = getDb(env.DB);
  const serviceId = params.serviceId ?? params.workerId;
  if (!serviceId) {
    throw new BadRequestError('Service runtime config requires a service identifier');
  }
  const timestamp = now();
  const compatibilityFlags = Array.from(new Set((params.compatibilityFlags || []).filter((flag) => typeof flag === 'string' && flag.trim().length > 0)));
  const limits = normalizeLimits(params.limits);

  // Upsert runtime settings
  await db.insert(serviceRuntimeSettings)
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
  await db.delete(serviceRuntimeFlags)
    .where(eq(serviceRuntimeFlags.serviceId, serviceId));

  if (compatibilityFlags.length > 0) {
    await db.insert(serviceRuntimeFlags)
      .values(compatibilityFlags.map((flag) => ({
        serviceId,
        flag,
      })));
  }

  // Replace limits: delete all then insert
  await db.delete(serviceRuntimeLimits)
    .where(eq(serviceRuntimeLimits.serviceId, serviceId));

  if (limits.cpu_ms !== undefined || limits.subrequests !== undefined) {
    await db.insert(serviceRuntimeLimits)
      .values({
        serviceId,
        cpuMs: limits.cpu_ms ?? null,
        memoryMb: null,
        subrequestLimit: limits.subrequests ?? null,
      });
  }

  // Replace MCP endpoints: delete all then insert
  await db.delete(serviceMcpEndpoints)
    .where(eq(serviceMcpEndpoints.serviceId, serviceId));

  if (params.mcpServer) {
    await db.insert(serviceMcpEndpoints)
      .values({
        serviceId,
        name: params.mcpServer.name,
        path: params.mcpServer.path,
        enabled: !!params.mcpServer.enabled,
      });
  }

  return getRuntimeConfig(env, params.spaceId, serviceId);
}
