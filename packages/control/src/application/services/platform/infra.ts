import { getDb, infraEndpointRoutes } from '../../../infra/db';
import { infraEndpoints, serviceRuntimes } from '../../../infra/db/schema-platform';
import type { Env } from '../../../shared/types';
import { generateId, now, safeJsonParseOrDefault } from '../../../shared/utils';
import type { HttpRoute, RoutingTarget, StoredHttpEndpoint } from '../routing/types';
import { eq, and, sql } from 'drizzle-orm';

export class InfraService {
  constructor(private env: Env) {}

  async upsertServiceRuntime(params: {
    spaceId: string;
    bundleDeploymentId: string;
    name: string;
    runtime: string;
    cloudflareServiceRef?: string;
  }): Promise<string> {
    const db = getDb(this.env.DB);
    const existing = await db
      .select({ id: serviceRuntimes.id })
      .from(serviceRuntimes)
      .where(and(eq(serviceRuntimes.accountId, params.spaceId), eq(serviceRuntimes.name, params.name)))
      .get();

    const ts = now();
    if (existing) {
      await db
        .update(serviceRuntimes)
        .set({
          runtime: params.runtime,
          cloudflareServiceRef: params.cloudflareServiceRef,
          bundleDeploymentId: params.bundleDeploymentId,
          updatedAt: ts,
        })
        .where(eq(serviceRuntimes.id, existing.id));
      return existing.id;
    }

    const id = generateId();
    await db.insert(serviceRuntimes).values({
      id,
      accountId: params.spaceId,
      name: params.name,
      runtime: params.runtime,
      cloudflareServiceRef: params.cloudflareServiceRef,
      bundleDeploymentId: params.bundleDeploymentId,
      createdAt: ts,
      updatedAt: ts,
    });
    return id;
  }

  async upsertWorker(params: {
    spaceId: string;
    bundleDeploymentId: string;
    name: string;
    runtime: string;
    cloudflareServiceRef?: string;
  }): Promise<string> {
    return this.upsertServiceRuntime({
      spaceId: params.spaceId,
      bundleDeploymentId: params.bundleDeploymentId,
      name: params.name,
      runtime: params.runtime,
      cloudflareServiceRef: params.cloudflareServiceRef,
    });
  }

  async upsertServiceEndpoint(params: {
    spaceId: string;
    bundleDeploymentId: string;
    name: string;
    protocol: string;
    targetServiceRef: string;
    routes: HttpRoute[];
    timeoutMs?: number;
  }): Promise<string> {
    const db = getDb(this.env.DB);
    const existing = await db
      .select({ id: infraEndpoints.id })
      .from(infraEndpoints)
      .where(and(eq(infraEndpoints.accountId, params.spaceId), eq(infraEndpoints.name, params.name)))
      .get();

    const ts = now();
    if (existing) {
      await db
        .update(infraEndpoints)
        .set({
          protocol: params.protocol,
          targetServiceRef: params.targetServiceRef,
          timeoutMs: params.timeoutMs,
          bundleDeploymentId: params.bundleDeploymentId,
          updatedAt: ts,
        })
        .where(eq(infraEndpoints.id, existing.id));

      // Delete existing routes and re-create
      await db
        .delete(infraEndpointRoutes)
        .where(eq(infraEndpointRoutes.endpointId, existing.id));

      for (let index = 0; index < params.routes.length; index++) {
        const route = params.routes[index];
        await db.insert(infraEndpointRoutes).values({
          endpointId: existing.id,
          position: index,
          pathPrefix: route.pathPrefix ?? null,
          methodsJson: route.methods ? JSON.stringify(route.methods) : null,
        });
      }

      return existing.id;
    }

    const id = generateId();
    await db.insert(infraEndpoints).values({
      id,
      accountId: params.spaceId,
      name: params.name,
      protocol: params.protocol,
      targetServiceRef: params.targetServiceRef,
      timeoutMs: params.timeoutMs,
      bundleDeploymentId: params.bundleDeploymentId,
      createdAt: ts,
      updatedAt: ts,
    });

    for (let index = 0; index < params.routes.length; index++) {
      const route = params.routes[index];
      await db.insert(infraEndpointRoutes).values({
        endpointId: id,
        position: index,
        pathPrefix: route.pathPrefix ?? null,
        methodsJson: route.methods ? JSON.stringify(route.methods) : null,
      });
    }

    return id;
  }

  async upsertEndpoint(params: {
    spaceId: string;
    bundleDeploymentId: string;
    name: string;
    protocol: string;
    targetServiceRef: string;
    routes: HttpRoute[];
    timeoutMs?: number;
  }): Promise<string> {
    return this.upsertServiceEndpoint({
      spaceId: params.spaceId,
      bundleDeploymentId: params.bundleDeploymentId,
      name: params.name,
      protocol: params.protocol,
      targetServiceRef: params.targetServiceRef,
      routes: params.routes,
      timeoutMs: params.timeoutMs,
    });
  }

  /**
   * Build an http-endpoint-set RoutingTarget from InfraEndpoint records.
   * Current contract only exposes cloudflare.worker targets to routing.
   */
  async buildRoutingTarget(spaceId: string, bundleDeploymentId: string): Promise<RoutingTarget | null> {
    const db = getDb(this.env.DB);
    const endpoints = await db
      .select()
      .from(infraEndpoints)
      .where(and(eq(infraEndpoints.accountId, spaceId), eq(infraEndpoints.bundleDeploymentId, bundleDeploymentId)))
      .all();

    if (endpoints.length === 0) return null;

    // Load routes for all endpoints
    const endpointIds = endpoints.map((ep) => ep.id);
    const allRoutes = await db
      .select()
      .from(infraEndpointRoutes)
      .where(sql`${infraEndpointRoutes.endpointId} IN (${sql.join(endpointIds.map(id => sql`${id}`), sql`, `)})`)
      .orderBy(infraEndpointRoutes.position)
      .all();

    const routesByEndpoint = new Map<string, typeof allRoutes>();
    for (const route of allRoutes) {
      const arr = routesByEndpoint.get(route.endpointId) ?? [];
      arr.push(route);
      routesByEndpoint.set(route.endpointId, arr);
    }

    const runtimeRows = await db
      .select()
      .from(serviceRuntimes)
      .where(and(eq(serviceRuntimes.accountId, spaceId), eq(serviceRuntimes.bundleDeploymentId, bundleDeploymentId)))
      .all();

    const serviceRuntimeByName = new Map(runtimeRows.map((runtime) => [runtime.name, runtime]));

    const storedEndpoints: StoredHttpEndpoint[] = [];
    for (const ep of endpoints) {
      const epRoutes = (routesByEndpoint.get(ep.id) ?? []).map((route) => ({
        pathPrefix: route.pathPrefix ?? undefined,
        methods: route.methodsJson ? safeJsonParseOrDefault<string[]>(route.methodsJson, []) : undefined,
      }));
      const serviceRuntime = serviceRuntimeByName.get(ep.targetServiceRef);
      const cloudflareServiceRef = serviceRuntime?.cloudflareServiceRef || ep.targetServiceRef;
      const runtime = serviceRuntime?.runtime || 'cloudflare.worker';

      if (runtime !== 'cloudflare.worker') continue;

      storedEndpoints.push({
        name: ep.name,
        routes: epRoutes,
        target: { kind: 'service-ref', ref: cloudflareServiceRef },
        ...(ep.timeoutMs !== null && ep.timeoutMs !== undefined ? { timeoutMs: ep.timeoutMs } : {}),
      });
    }

    if (storedEndpoints.length === 0) return null;

    return { type: 'http-endpoint-set', endpoints: storedEndpoints };
  }

  async deleteByBundleDeployment(spaceId: string, bundleDeploymentId: string): Promise<void> {
    const db = getDb(this.env.DB);

    // Delete endpoint routes for matching endpoints first
    const endpointsToDelete = await db
      .select({ id: infraEndpoints.id })
      .from(infraEndpoints)
      .where(and(eq(infraEndpoints.accountId, spaceId), eq(infraEndpoints.bundleDeploymentId, bundleDeploymentId)))
      .all();

    for (const ep of endpointsToDelete) {
      await db.delete(infraEndpointRoutes).where(eq(infraEndpointRoutes.endpointId, ep.id));
    }

    await db
      .delete(infraEndpoints)
      .where(and(eq(infraEndpoints.accountId, spaceId), eq(infraEndpoints.bundleDeploymentId, bundleDeploymentId)));
    await db
      .delete(serviceRuntimes)
      .where(and(eq(serviceRuntimes.accountId, spaceId), eq(serviceRuntimes.bundleDeploymentId, bundleDeploymentId)));
  }
}
