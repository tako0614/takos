import type { DbEnv } from '../../../shared/types';
import { deployments, getDb, serviceDeployments, services } from '../../../infra/db';
import { eq, and, ne, inArray } from 'drizzle-orm';
import { deleteHostnameRouting, resolveHostnameRouting, upsertHostnameRouting } from '../routing';
import type { RoutingBindings, RoutingTarget } from '../routing/types';
import { parseDeploymentTargetConfig } from './provider';
import {
  getDeploymentRoutingServiceRecord,
  type DeploymentRoutingServiceRecord,
  updateServiceDeploymentPointers,
} from './store';
import type { DeploymentTarget } from './types';

type DeploymentRoutingEnv = DbEnv & RoutingBindings;

export type RoutingSnapshot = Array<{ hostname: string; target: RoutingTarget | null }>;

type ActiveDeploymentInfo = {
  id: string;
  artifactRef: string | null;
  targetJson: string;
  routingStatus: string;
};

type RoutingContext = {
  deploymentId: string;
  deploymentVersion: number;
  deployArtifactRef: string;
  deploymentTarget: DeploymentTarget;
  serviceRouteRecord: DeploymentRoutingServiceRecord;
  desiredRoutingStatus: string;
  desiredRoutingWeight: number;
  activeDeployment: ActiveDeploymentInfo | null;
};

type RoutingPlan = {
  target: RoutingTarget;
  auditDetails: Record<string, unknown>;
};

function resolveDeploymentRouteRef(input: {
  deploymentTarget?: DeploymentTarget;
  targetJson?: string;
  artifactRef: string | null;
}): string | null {
  const target = input.deploymentTarget
    ?? (input.targetJson
      ? parseDeploymentTargetConfig({
          provider_name: 'cloudflare',
          target_json: input.targetJson,
        })
      : undefined);
  const routeRef = target?.route_ref?.trim()
    || (target?.endpoint?.kind === 'service-ref' ? target.endpoint.ref.trim() : '')
    || input.artifactRef?.trim()
    || '';
  return routeRef || null;
}

function normalizeCanaryWeight(raw: number): number {
  if (!Number.isFinite(raw)) return 1;
  const normalized = Math.floor(raw);
  return Math.min(99, Math.max(1, normalized));
}

export function collectHostnames(serviceRouteRecord: {
  hostname: string | null;
  customDomains: Array<{ domain: string | null }>;
}): string[] {
  const hostnames = new Set<string>();
  if (serviceRouteRecord.hostname) hostnames.add(serviceRouteRecord.hostname.toLowerCase());
  for (const customDomain of serviceRouteRecord.customDomains) {
    if (customDomain.domain) hostnames.add(customDomain.domain.toLowerCase());
  }
  return Array.from(hostnames);
}

export async function snapshotRouting(env: DeploymentRoutingEnv, hostnameList: string[]): Promise<RoutingSnapshot> {
  const snapshots: RoutingSnapshot = [];
  for (const hostname of hostnameList) {
    const resolved = await resolveHostnameRouting({ env, hostname });
    snapshots.push({ hostname, target: resolved.tombstone ? null : resolved.target });
  }
  return snapshots;
}

export async function restoreRoutingSnapshot(env: DeploymentRoutingEnv, snapshot: RoutingSnapshot): Promise<void> {
  for (const item of snapshot) {
    if (item.target) {
      await upsertHostnameRouting({ env, hostname: item.hostname, target: item.target });
    } else {
      await deleteHostnameRouting({ env, hostname: item.hostname });
    }
  }
}

export function buildRoutingTarget(ctx: RoutingContext, hostnameList: string[]): RoutingPlan {
  const baseDetails: Record<string, unknown> = {
    hostnames: hostnameList,
    desired_routing_status: ctx.desiredRoutingStatus,
    desired_routing_weight: ctx.desiredRoutingWeight,
    deployment_target_endpoint_kind: ctx.deploymentTarget.endpoint?.kind ?? null,
  };

  if (ctx.deploymentTarget.endpoint?.kind === 'http-url') {
    if (ctx.desiredRoutingStatus === 'canary') {
      throw new Error('http-url deployment targets do not support canary routing');
    }

    const endpointName = ctx.deploymentTarget.route_ref
      || ctx.deployArtifactRef;
    return {
      target: {
        type: 'http-endpoint-set',
        endpoints: [
          {
            name: endpointName,
            routes: [],
            target: {
              kind: 'http-url',
              baseUrl: ctx.deploymentTarget.endpoint.base_url,
            },
          },
        ],
      },
      auditDetails: {
        ...baseDetails,
        mode: 'http-url',
        http_endpoint: ctx.deploymentTarget.endpoint.base_url,
        route_ref: ctx.deploymentTarget.route_ref ?? null,
      },
    };
  }

  const deploymentRouteRef = resolveDeploymentRouteRef({
    deploymentTarget: ctx.deploymentTarget,
    artifactRef: ctx.deployArtifactRef,
  });
  if (!deploymentRouteRef) {
    throw new Error('Deployment route ref is missing');
  }

  if (ctx.desiredRoutingStatus !== 'canary') {
    const deploymentStatus = ctx.desiredRoutingStatus === 'rollback' ? 'rollback' : 'active';
    return {
      target: {
        type: 'deployments',
        deployments: [
          {
            routeRef: deploymentRouteRef,
            weight: 100,
            deploymentId: ctx.deploymentId,
            status: deploymentStatus,
          },
        ],
      },
      auditDetails: {
        ...baseDetails,
        mode: deploymentStatus,
        artifact_ref: ctx.deployArtifactRef,
        route_ref: deploymentRouteRef,
        active_deployment_id: ctx.serviceRouteRecord.activeDeploymentId,
      },
    };
  }

  const canaryWeight = normalizeCanaryWeight(ctx.desiredRoutingWeight);
  const activeWeight = 100 - canaryWeight;
  const activeRouteRef = ctx.activeDeployment
    ? resolveDeploymentRouteRef({
        targetJson: ctx.activeDeployment.targetJson,
        artifactRef: ctx.activeDeployment.artifactRef,
      })
    : null;
  if (!activeRouteRef) {
    throw new Error('Active deployment route ref is missing');
  }

  return {
    target: {
      type: 'deployments',
      deployments: [
        {
          routeRef: activeRouteRef,
          weight: activeWeight,
          deploymentId: ctx.activeDeployment?.id,
          status: ctx.activeDeployment?.routingStatus === 'rollback' ? 'rollback' : 'active',
        },
        {
          routeRef: deploymentRouteRef,
          weight: canaryWeight,
          deploymentId: ctx.deploymentId,
          status: 'canary',
        },
      ],
    },
    auditDetails: {
      ...baseDetails,
      mode: 'canary',
      active_weight: activeWeight,
      canary_weight: canaryWeight,
      active_deployment_id: ctx.activeDeployment?.id,
      active_route_ref: activeRouteRef,
      canary_route_ref: deploymentRouteRef,
    },
  };
}

export async function applyRoutingDbUpdates(
  env: DeploymentRoutingEnv,
  ctx: RoutingContext,
  nowIso: string,
): Promise<void> {
  const db = getDb(env.DB);

  if (ctx.desiredRoutingStatus !== 'canary') {
    await db.update(deployments)
      .set({
        routingStatus: 'archived',
        routingWeight: 0,
        updatedAt: nowIso,
      })
      .where(
        and(
        eq(serviceDeployments.serviceId, ctx.serviceRouteRecord.id),
          ne(deployments.id, ctx.deploymentId),
          inArray(deployments.routingStatus, ['active', 'rollback', 'canary']),
        )
      )
      .run();

    await db.update(deployments)
      .set({
        routingStatus: 'active',
        routingWeight: 100,
        updatedAt: nowIso,
      })
      .where(eq(deployments.id, ctx.deploymentId))
      .run();

    await updateServiceDeploymentPointers(env.DB, ctx.serviceRouteRecord.id, {
      status: 'deployed',
      fallbackDeploymentId: ctx.serviceRouteRecord.activeDeploymentId ?? null,
      activeDeploymentId: ctx.deploymentId,
      activeDeploymentVersion: ctx.deploymentVersion,
      updatedAt: nowIso,
    });

    return;
  }

  const canaryWeight = normalizeCanaryWeight(ctx.desiredRoutingWeight);
  const activeWeight = 100 - canaryWeight;

  if (ctx.activeDeployment?.id) {
    await db.update(deployments)
      .set({
        routingStatus: ctx.activeDeployment.routingStatus === 'rollback' ? 'rollback' : 'active',
        routingWeight: activeWeight,
        updatedAt: nowIso,
      })
      .where(eq(deployments.id, ctx.activeDeployment.id))
      .run();
  }

  await db.update(deployments)
    .set({
      routingStatus: 'archived',
      routingWeight: 0,
      updatedAt: nowIso,
    })
    .where(
      and(
        eq(serviceDeployments.serviceId, ctx.serviceRouteRecord.id),
        eq(deployments.routingStatus, 'canary'),
        ne(deployments.id, ctx.deploymentId),
      )
    )
    .run();

  await db.update(deployments)
    .set({
      routingStatus: 'canary',
      routingWeight: canaryWeight,
      updatedAt: nowIso,
    })
    .where(eq(deployments.id, ctx.deploymentId))
    .run();

  await db.update(services)
    .set({
      status: 'deployed',
      updatedAt: nowIso,
    })
    .where(eq(services.id, ctx.serviceRouteRecord.id))
    .run();
}

export async function applyRoutingToHostnames(
  env: DeploymentRoutingEnv,
  hostnameList: string[],
  target: RoutingTarget,
): Promise<void> {
  for (const hostname of hostnameList) {
    await upsertHostnameRouting({ env, hostname, target });
  }
}

export async function fetchServiceWithDomains(env: DeploymentRoutingEnv, serviceId: string): Promise<DeploymentRoutingServiceRecord | null> {
  return getDeploymentRoutingServiceRecord(env.DB, serviceId);
}
