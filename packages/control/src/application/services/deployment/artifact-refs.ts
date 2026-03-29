/**
 * Pure helper / utility functions for the deployment service.
 *
 * These are stateless functions extracted from service.ts to reduce file size
 * and improve testability.
 */
import type { WorkerBinding } from '../../../platform/providers/cloudflare/wfp.ts';
import { safeJsonParseOrDefault } from '../../../shared/utils';
import type { ServiceRuntimeConfigState } from '../platform/worker-desired-state';
import type {
  ArtifactKind,
  Deployment,
  CreateDeploymentInput,
  DeploymentTarget,
} from './models';
import {
  parseDeploymentTargetConfig,
} from './provider';
import { BadRequestError, ConflictError } from 'takos-common/errors';

export function resolveDeploymentArtifactBaseRef(serviceId: string, target?: DeploymentTarget): string {
  const routeRef = target?.route_ref?.trim()
    || (target?.endpoint?.kind === 'service-ref' ? target.endpoint.ref.trim() : '')
    || '';
  return routeRef || `worker-${serviceId}`;
}

export function buildDeploymentArtifactRef(baseRef: string, version: number): string {
  return `${baseRef}-v${version}`;
}

export function resolveDeploymentArtifactRef(options: {
  serviceId: string;
  version: number;
  target?: DeploymentTarget;
  persistedArtifactRef?: string | null;
}): string {
  const persistedArtifactRef = options.persistedArtifactRef?.trim();
  if (persistedArtifactRef) {
    return persistedArtifactRef;
  }
  return buildDeploymentArtifactRef(
    resolveDeploymentArtifactBaseRef(options.serviceId, options.target),
    options.version,
  );
}

export function resolveDeploymentServiceId(input: {
  workerId?: string | null;
  serviceId?: string | null;
}): string {
  const serviceId = input.serviceId?.trim() || input.workerId?.trim() || '';
  if (!serviceId) {
    throw new BadRequestError('Deployment requires a service identifier');
  }
  return serviceId;
}

export function extractErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function parseRuntimeConfig(raw: string | null | undefined): ServiceRuntimeConfigState {
  const parsed = safeJsonParseOrDefault<{
    compatibility_date?: string;
    compatibility_flags?: string[];
    limits?: { cpu_ms?: number; subrequests?: number };
    mcp_server?: ServiceRuntimeConfigState['mcp_server'];
  }>(raw, {});

  return {
    compatibility_date: parsed.compatibility_date,
    compatibility_flags: Array.isArray(parsed.compatibility_flags) ? parsed.compatibility_flags : [],
    limits: parsed.limits && typeof parsed.limits === 'object' ? parsed.limits : {},
    mcp_server: parsed.mcp_server,
    updated_at: null,
  };
}

export function snapshotFromOverride(
  override: NonNullable<CreateDeploymentInput['snapshotOverride']>
): {
  envVars: Record<string, string>;
  bindings: WorkerBinding[];
  runtimeConfig: ServiceRuntimeConfigState;
} {
  return {
    envVars: { ...override.envVars },
    bindings: [...override.bindings],
    runtimeConfig: {
      compatibility_date: override.runtimeConfig?.compatibility_date,
      compatibility_flags: override.runtimeConfig?.compatibility_flags ?? [],
      limits: override.runtimeConfig?.limits ?? {},
      mcp_server: override.runtimeConfig?.mcp_server,
      updated_at: null,
    },
  };
}

export function assertMatchingIdempotentRequest(
  deployment: Deployment,
  expected: {
    artifactKind: ArtifactKind;
    bundleHash: string | null;
    bundleSize: number | null;
    imageRef?: string;
    strategy: 'direct' | 'canary';
    canaryWeight?: number;
  }
): void {
  const expectedRoutingStatus = expected.strategy === 'canary' ? 'canary' : 'active';
  const expectedRoutingWeight = expected.strategy === 'canary'
    ? expected.canaryWeight ?? 1
    : 100;

  if (
    deployment.routing_status !== expectedRoutingStatus ||
    deployment.routing_weight !== expectedRoutingWeight
  ) {
    throw new ConflictError('Idempotency-Key reuse does not match the original deployment request');
  }

  if (expected.artifactKind === 'container-image') {
    const deploymentTarget = parseDeploymentTargetConfig(deployment);
    const existingImageRef = deploymentTarget.artifact?.image_ref;
    if (existingImageRef !== expected.imageRef) {
      throw new ConflictError('Idempotency-Key reuse does not match the original deployment request');
    }
  } else {
    if (
      deployment.bundle_hash !== expected.bundleHash ||
      deployment.bundle_size !== expected.bundleSize
    ) {
      throw new ConflictError('Idempotency-Key reuse does not match the original deployment request');
    }
  }
}
