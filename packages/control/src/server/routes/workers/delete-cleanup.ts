import { eq } from "drizzle-orm";
import {
  createCommonEnvDeps,
  deleteServiceTakosAccessTokenConfig,
} from "../../../application/services/common-env/index.ts";
import {
  deleteCloudflareCustomHostname,
} from "../../../application/services/platform/custom-domains.ts";
import {
  deleteService,
  type ServiceRow,
} from "../../../application/services/platform/workers.ts";
import { deleteHostnameRouting } from "../../../application/services/routing/service.ts";
import { getDb } from "../../../infra/db/index.ts";
import { deployments, serviceCustomDomains } from "../../../infra/db/schema.ts";
import { createOptionalCloudflareWfpBackend } from "../../../platform/backends/cloudflare/wfp.ts";
import { logWarn } from "../../../shared/utils/logger.ts";
import type { AppContext } from "../route-auth.ts";

async function cleanupServiceCustomDomains(
  c: AppContext,
  serviceId: string,
): Promise<void> {
  const db = getDb(c.env.DB);
  const customDomains = await db.select({
    id: serviceCustomDomains.id,
    domain: serviceCustomDomains.domain,
    cfCustomHostnameId: serviceCustomDomains.cfCustomHostnameId,
  }).from(serviceCustomDomains).where(
    eq(serviceCustomDomains.serviceId, serviceId),
  ).all();

  for (const customDomain of customDomains) {
    try {
      await deleteHostnameRouting({
        env: c.env,
        hostname: customDomain.domain,
        executionCtx: c.executionCtx,
      });
    } catch (e) {
      logWarn("Failed to delete custom domain routing", {
        module: "routes/services/base",
        error: e instanceof Error ? e.message : String(e),
      });
    }

    if (!customDomain.cfCustomHostnameId) {
      continue;
    }

    try {
      await deleteCloudflareCustomHostname(
        c.env,
        customDomain.cfCustomHostnameId,
      );
    } catch (e) {
      logWarn("Failed to delete CF custom hostname", {
        module: "routes/services/base",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (customDomains.length > 0) {
    await db.delete(serviceCustomDomains).where(
      eq(serviceCustomDomains.serviceId, serviceId),
    ).run();
  }
}

async function cleanupPrimaryHostname(
  c: AppContext,
  hostname: string | null,
): Promise<void> {
  if (!hostname) {
    return;
  }

  try {
    await deleteHostnameRouting({
      env: c.env,
      hostname,
      executionCtx: c.executionCtx,
    });
  } catch (e) {
    logWarn("Failed to delete hostname routing", {
      module: "routes/services/base",
      error: e instanceof Error ? e.message : String(e),
    });
  }
}

async function cleanupServiceArtifacts(
  c: AppContext,
  worker: Pick<ServiceRow, "id" | "service_name">,
): Promise<void> {
  const db = getDb(c.env.DB);
  const deploymentArtifacts = await db.select({
    artifactRef: deployments.artifactRef,
  }).from(deployments).where(eq(deployments.serviceId, worker.id)).all();

  const artifactRefs = new Set<string>();
  if (worker.service_name) {
    artifactRefs.add(worker.service_name);
  }
  for (const deployment of deploymentArtifacts) {
    if (deployment.artifactRef) {
      artifactRefs.add(deployment.artifactRef);
    }
  }

  if (artifactRefs.size === 0) {
    return;
  }

  const wfp = createOptionalCloudflareWfpBackend(c.env);
  if (!wfp) {
    logWarn(
      "Skipping WFP artifact cleanup because Cloudflare WFP is not configured",
      {
        module: "routes/services/base",
        details: Array.from(artifactRefs),
      },
    );
    return;
  }

  for (const artifactRef of artifactRefs) {
    try {
      await wfp.workers.deleteWorker(artifactRef);
    } catch (e) {
      logWarn("Failed to delete WFP artifact", {
        module: "routes/services/base",
        details: [
          artifactRef,
          e instanceof Error ? e.message : String(e),
        ],
      });
    }
  }
}

async function cleanupServiceAccessTokenConfig(
  c: AppContext,
  worker: Pick<ServiceRow, "id" | "space_id">,
): Promise<void> {
  const deps = createCommonEnvDeps(c.env);
  await deleteServiceTakosAccessTokenConfig(deps.manualLink, {
    spaceId: worker.space_id,
    serviceId: worker.id,
  });
}

export async function deleteServiceWithCleanup(
  c: AppContext,
  worker: ServiceRow,
): Promise<void> {
  await cleanupServiceCustomDomains(c, worker.id);
  await cleanupPrimaryHostname(c, worker.hostname);
  await cleanupServiceArtifacts(c, worker);
  await cleanupServiceAccessTokenConfig(c, worker);
  await deleteService(c.env.DB, worker.id);
}
