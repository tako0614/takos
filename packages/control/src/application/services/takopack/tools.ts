import { getDb } from '../../../infra/db';
import { services } from '../../../infra/db/schema-services';
import { eq, and } from 'drizzle-orm';
import type { Env } from '../../../shared/types';
import { upsertManagedMcpServer } from '../platform/mcp';
import { resolveServiceRouteSummaryForWorkspace } from '../platform/workers';
import type { ManifestMcpServer } from './types';

export class BundleManagedMcpService {
  constructor(private env: Env) {}

  private buildManagedServerName(serverName: string, installKey: string): string {
    const suffix = installKey
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 8) || 'install';
    return `${serverName}_${suffix}`;
  }

  async registerManagedMcpServer(
    spaceId: string,
    bundleDeploymentId: string,
    installKey: string,
    server: ManifestMcpServer,
    deployedWorkerIdByRef?: Map<string, string>
  ): Promise<void> {
    const db = getDb(this.env.DB);
    const workerRef = server.worker?.trim();
    if (!workerRef) {
      throw new Error(`Managed MCP server "${server.name}" is missing worker reference`);
    }

    const mappedWorkerId = deployedWorkerIdByRef?.get(workerRef);
    let resolvedWorkerId = mappedWorkerId ?? null;
    const workerSummary = resolvedWorkerId
      ? await db.select({ id: services.id, hostname: services.hostname }).from(services).where(
          and(
            eq(services.accountId, spaceId),
            eq(services.id, resolvedWorkerId),
          )
        ).get()
      : await resolveServiceRouteSummaryForWorkspace(this.env.DB, spaceId, workerRef);

    if (!workerSummary) {
      throw new Error(`Worker not found for MCP server "${server.name}": ${workerRef}`);
    }

    resolvedWorkerId = workerSummary.id;
    const url = workerSummary.hostname ? `https://${workerSummary.hostname}${server.path}` : null;
    if (!url) {
      throw new Error(`Worker hostname not available for MCP server "${server.name}"`);
    }

    await upsertManagedMcpServer(this.env.DB, this.env, {
      spaceId,
      bundleDeploymentId,
      sourceType: 'bundle_deployment',
      name: this.buildManagedServerName(server.name, installKey),
      url,
      serviceId: resolvedWorkerId,
    });
  }
}
