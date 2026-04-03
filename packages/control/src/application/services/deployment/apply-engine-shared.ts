import { getDb } from "../../../infra/db/client.ts";
import type {
  AppContainer,
  AppManifest,
  AppService,
  AppWorker,
} from "../source/app-manifest-types.ts";
import {
  compileGroupDesiredState,
  type GroupDesiredState,
} from "./group-state.ts";
import {
  assertTranslationSupported,
  buildTranslationReport,
} from "./translation-report.ts";
import {
  createResource,
  deleteResource,
  listResources,
  updateManagedResource,
} from "../entities/resource-ops.ts";
import { deleteWorker } from "../entities/worker-ops.ts";
import { deleteContainer } from "../entities/container-ops.ts";
import { deleteService } from "../entities/service-ops.ts";
import {
  listGroupManagedServices,
  upsertGroupManagedService,
} from "../entities/group-managed-services.ts";
import { DeploymentService } from "./service.ts";
import { findDeploymentByArtifactRef, getDeploymentById } from "./store.ts";
import { getBundleContent } from "./artifact-io.ts";
import { syncGroupManagedDesiredState } from "./group-managed-desired-state.ts";
import { reconcileGroupRouting } from "./group-routing.ts";
import { safeJsonParseOrDefault } from "../../../shared/utils/logger.ts";
import type { Env } from "../../../shared/types/env.ts";

export type GroupRow = {
  id: string;
  spaceId: string;
  name: string;
  provider: string | null;
  env: string | null;
  appVersion: string | null;
  desiredSpecJson: string | null;
  providerStateJson: string | null;
  reconcileStatus: string;
  lastAppliedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApplyWorkerArtifact = {
  kind: "worker_bundle";
  bundleContent: string;
  deployMessage?: string;
};

export type ApplyContainerArtifact = {
  kind: "container_image";
  imageRef: string;
  provider?: "oci" | "ecs" | "cloud-run" | "k8s";
  deployMessage?: string;
};

export type ApplyArtifactInput = ApplyWorkerArtifact | ApplyContainerArtifact;

export type WorkerDirectArtifact = {
  kind: "bundle";
  deploymentId?: string;
  artifactRef?: string;
};

export type ImageDirectArtifact = {
  kind: "image";
  imageRef: string;
  provider?: "oci" | "ecs" | "cloud-run" | "k8s";
};

export const applyEngineDeps = {
  getDb,
  listResources,
  createResource,
  deleteResource,
  updateManagedResource,
  deleteWorker,
  deleteContainer,
  deleteService,
  listGroupManagedServices,
  upsertGroupManagedService,
  DeploymentService,
  findDeploymentByArtifactRef,
  getDeploymentById,
  getBundleContent,
  syncGroupManagedDesiredState,
  reconcileGroupRouting,
  buildTranslationReport,
  assertTranslationSupported,
  compileGroupDesiredState,
};

export function loadDesiredManifest(group: GroupRow): AppManifest | null {
  return safeJsonParseOrDefault<AppManifest | null>(
    group.desiredSpecJson,
    null,
  );
}

export function loadDesiredState(group: GroupRow): GroupDesiredState | null {
  const manifest = loadDesiredManifest(group);
  if (!manifest) return null;
  try {
    return compileGroupDesiredState(manifest, {
      groupName: group.name,
      provider: group.provider ?? "cloudflare",
      envName: group.env ?? "default",
    });
  } catch {
    return null;
  }
}

export type ApplyWorkloadSpec = AppWorker | AppContainer | AppService;

export type ApplyGroupStateLoader = (
  env: Env,
  groupId: string,
) => Promise<import("./diff.ts").GroupState | null>;
