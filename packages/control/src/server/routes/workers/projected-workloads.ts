import { parseDeploymentTargetConfig } from "../../../application/services/deployment/provider.ts";
import type {
  AppService,
  AppWorker,
} from "../../../application/services/source/app-manifest-types.ts";

type ServiceType = "app" | "service";

function normalizeServiceType(serviceType: string): ServiceType {
  return serviceType === "service" ? "service" : "app";
}

export type GroupWorkloadTarget = {
  category: "worker" | "service";
  name: string;
};

export type GroupWorkloadDeployment = {
  id: string;
  artifactRef: string | null;
  providerName: string;
  targetJson: string;
};

function parseServiceConfig(config: string | null): Record<string, unknown> {
  if (!config) return {};
  try {
    return JSON.parse(config) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function buildProjectedWorkerSpec(_input: {
  deploymentId?: string | null;
  artifactRef?: string | null;
}): AppWorker {
  // Flat schema does not carry per-worker artifact pointers on the manifest;
  // the deploy pipeline resolves the active deployment for the worker by name.
  return {
    kind: "worker",
  };
}

function buildProjectedServiceSpec(
  config: Record<string, unknown>,
  deploymentTarget?: ReturnType<typeof parseDeploymentTargetConfig>,
): AppService {
  const imageRef = deploymentTarget?.artifact?.image_ref ??
    (typeof config.imageRef === "string" ? config.imageRef : undefined);
  const port = typeof deploymentTarget?.artifact?.exposed_port === "number"
    ? deploymentTarget.artifact.exposed_port
    : (typeof config.port === "number" ? config.port : 80);
  const healthPath = typeof deploymentTarget?.artifact?.health_path === "string"
    ? deploymentTarget.artifact.health_path
    : (typeof config.healthPath === "string" ? config.healthPath : undefined);

  return {
    kind: "service",
    port,
    ...(imageRef ? { image: imageRef } : {}),
    ...(healthPath ? { healthCheck: { path: healthPath } } : {}),
  };
}

export function describeGroupWorkloadTarget(input: {
  id: string;
  slug: string | null;
  serviceType: string;
}): GroupWorkloadTarget {
  const serviceType = normalizeServiceType(input.serviceType);
  return {
    category: serviceType === "app" ? "worker" : "service",
    name: input.slug ?? input.id,
  };
}

export function buildGroupWorkloadForCreate(input: {
  serviceType: string;
  config: string | null;
}): AppWorker | AppService {
  if (normalizeServiceType(input.serviceType) === "app") {
    return buildProjectedWorkerSpec({});
  }

  return buildProjectedServiceSpec(parseServiceConfig(input.config));
}

export function buildGroupWorkloadForAssignment(input: {
  serviceType: string;
  config: string | null;
  serviceName: string | null;
  activeDeployment?: GroupWorkloadDeployment | null;
}): AppWorker | AppService {
  if (normalizeServiceType(input.serviceType) === "app") {
    return buildProjectedWorkerSpec({
      deploymentId: input.activeDeployment?.id,
      artifactRef: input.activeDeployment?.artifactRef ?? input.serviceName,
    });
  }

  const deploymentTarget = input.activeDeployment
    ? parseDeploymentTargetConfig({
      provider_name: input.activeDeployment.providerName as never,
      target_json: input.activeDeployment.targetJson,
    })
    : undefined;

  return buildProjectedServiceSpec(
    parseServiceConfig(input.config),
    deploymentTarget,
  );
}
