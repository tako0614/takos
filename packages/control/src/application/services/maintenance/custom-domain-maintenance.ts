import type { Env } from "../../../shared/types/index.ts";
import { getDb, serviceCustomDomains } from "../../../infra/db/index.ts";
import { and, asc, eq, inArray, isNotNull, lt, or } from "drizzle-orm";

import {
  deleteManagedCustomHostname,
  getManagedCustomHostnameStatus,
} from "../platform/custom-domains.ts";
import {
  deleteHostnameRouting,
  upsertHostnameRouting,
} from "../routing/service.ts";
import type { RoutingTarget } from "../routing/routing-models.ts";
import { resolveRoutingTargetForServiceHostname } from "../routing/group-hostnames.ts";
import { ServiceDesiredStateService } from "../platform/worker-desired-state.ts";
import { listServiceRouteRecordsByIds } from "../platform/workers.ts";
import { logError, logWarn } from "../../../shared/utils/logger.ts";
import { verifyDNS } from "../platform/custom-domains/dns.ts";

const SSL_PENDING_STATES = new Set([
  "pending",
  "pending_validation",
  "pending_issuance",
  "pending_deployment",
]);
const SSL_FAILURE_STATES = new Set([
  "deleted",
  "expired",
  "validation_timed_out",
  "issuance_timed_out",
]);

export interface CustomDomainReverificationSummary {
  scanned: number;
  active: number;
  verifying: number;
  failed: number;
  expired: number;
  sslPromoted: number;
  errors: number;
}

export async function runCustomDomainReverification(
  env: Env,
  options?: { batchSize?: number },
): Promise<CustomDomainReverificationSummary> {
  const db = getDb(env.DB);
  const desiredState = new ServiceDesiredStateService(env);
  const batchSize = options?.batchSize ?? 200;
  const platformDomain = env.TENANT_BASE_DOMAIN;

  const domainRows = await db.select({
    id: serviceCustomDomains.id,
    domain: serviceCustomDomains.domain,
    status: serviceCustomDomains.status,
    verificationToken: serviceCustomDomains.verificationToken,
    verificationMethod: serviceCustomDomains.verificationMethod,
    cfCustomHostnameId: serviceCustomDomains.cfCustomHostnameId,
    sslStatus: serviceCustomDomains.sslStatus,
    serviceId: serviceCustomDomains.serviceId,
  })
    .from(serviceCustomDomains)
    .where(inArray(serviceCustomDomains.status, ["active", "ssl_pending"]))
    .orderBy(asc(serviceCustomDomains.updatedAt))
    .limit(batchSize)
    .all();

  const serviceRouteMap = new Map(
    (await listServiceRouteRecordsByIds(
      env.DB,
      [...new Set(domainRows.map((row) => row.serviceId).filter(Boolean))],
    )).map((service) => [service.id, service]),
  );

  const domains = domainRows.map((row) => ({
    id: row.id,
    domain: row.domain,
    status: row.status,
    verificationToken: row.verificationToken,
    verificationMethod: row.verificationMethod,
    cfCustomHostnameId: row.cfCustomHostnameId,
    sslStatus: row.sslStatus,
    service: {
      id: row.serviceId,
      space_id: serviceRouteMap.get(row.serviceId)?.accountId ?? "",
      group_id: serviceRouteMap.get(row.serviceId)?.groupId ?? null,
      hostname: serviceRouteMap.get(row.serviceId)?.hostname ?? null,
    },
  }));

  const summary: CustomDomainReverificationSummary = {
    scanned: domains.length,
    active: 0,
    verifying: 0,
    failed: 0,
    expired: 0,
    sslPromoted: 0,
    errors: 0,
  };

  for (const domain of domains) {
    try {
      // ssl_pending domains: skip DNS re-verification, only check provider SSL status
      if (domain.status === "ssl_pending") {
        if (!domain.cfCustomHostnameId) {
          // No managed hostname ID — shouldn't be in ssl_pending, reset to dns_verified
          await db.update(serviceCustomDomains)
            .set({
              status: "dns_verified",
              updatedAt: new Date().toISOString(),
            })
            .where(eq(serviceCustomDomains.id, domain.id))
            .run();
          summary.failed += 1;
          continue;
        }

        const hostnameStatus = await getManagedCustomHostnameStatus(
          env,
          domain.cfCustomHostnameId,
        );

        if (hostnameStatus && hostnameStatus.sslStatus === "active") {
          // SSL provisioned — promote to active and ensure KV routing
          await db.update(serviceCustomDomains)
            .set({
              status: "active",
              sslStatus: "active",
              updatedAt: new Date().toISOString(),
            })
            .where(eq(serviceCustomDomains.id, domain.id))
            .run();
          let target: RoutingTarget | null =
            await resolveRoutingTargetForServiceHostname(env, domain.service);
          target ??= await desiredState.getRoutingTarget(domain.service.id);
          if (target) {
            await upsertHostnameRouting({
              env,
              hostname: domain.domain,
              target,
            });
          }
          summary.sslPromoted += 1;
          summary.active += 1;
        } else if (
          hostnameStatus && SSL_FAILURE_STATES.has(hostnameStatus.sslStatus)
        ) {
          // SSL failed/expired — mark as ssl_failed and remove KV routing
          await db.update(serviceCustomDomains)
            .set({
              status: "ssl_failed",
              sslStatus: "failed",
              updatedAt: new Date().toISOString(),
            })
            .where(eq(serviceCustomDomains.id, domain.id))
            .run();
          await deleteHostnameRouting({ env, hostname: domain.domain });
          summary.failed += 1;
        } else {
          // Still pending — just touch updatedAt
          await db.update(serviceCustomDomains)
            .set({ updatedAt: new Date().toISOString() })
            .where(eq(serviceCustomDomains.id, domain.id))
            .run();
          summary.verifying += 1;
        }
        continue;
      }

      // Active domains: full DNS ownership re-verification
      await db.update(serviceCustomDomains)
        .set({
          status: "verifying",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(serviceCustomDomains.id, domain.id))
        .run();

      const ownershipMethod = domain.verificationMethod === "txt"
        ? "txt"
        : "cname";
      const ownershipExpected = ownershipMethod === "cname"
        ? `${domain.verificationToken}.verify.${platformDomain}`
        : domain.verificationToken;
      const ownershipVerification = await verifyDNS(
        domain.domain,
        ownershipExpected,
        ownershipMethod,
      );

      if (!ownershipVerification.verified) {
        await db.update(serviceCustomDomains)
          .set({
            status: "failed",
            sslStatus: "failed",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(serviceCustomDomains.id, domain.id))
          .run();
        await deleteHostnameRouting({ env, hostname: domain.domain });
        summary.failed += 1;
        continue;
      }

      let nextStatus: "active" | "verifying" | "failed" | "expired" = "active";
      let nextSslStatus: "active" | "pending" | "failed" | "external" =
        domain.cfCustomHostnameId ? "active" : "external";

      if (domain.cfCustomHostnameId) {
        const hostnameStatus = await getManagedCustomHostnameStatus(
          env,
          domain.cfCustomHostnameId,
        );

        if (hostnameStatus) {
          if (hostnameStatus.sslStatus === "active") {
            nextStatus = "active";
            nextSslStatus = "active";
          } else if (SSL_FAILURE_STATES.has(hostnameStatus.sslStatus)) {
            nextStatus = hostnameStatus.sslStatus === "expired"
              ? "expired"
              : "failed";
            nextSslStatus = "failed";
          } else if (SSL_PENDING_STATES.has(hostnameStatus.sslStatus)) {
            nextStatus = "verifying";
            nextSslStatus = "pending";
          } else {
            nextStatus = "verifying";
            nextSslStatus = "pending";
          }
        } else {
          nextStatus = "verifying";
          nextSslStatus = "pending";
        }
      }

      if (nextStatus === "active") {
        let target: RoutingTarget | null =
          await resolveRoutingTargetForServiceHostname(env, domain.service);
        target ??= await desiredState.getRoutingTarget(domain.service.id);

        if (target) {
          await upsertHostnameRouting({
            env,
            hostname: domain.domain,
            target,
          });
        }
      } else if (nextStatus === "failed" || nextStatus === "expired") {
        await deleteHostnameRouting({ env, hostname: domain.domain });
      }

      await db.update(serviceCustomDomains)
        .set({
          status: nextStatus,
          sslStatus: nextSslStatus,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(serviceCustomDomains.id, domain.id))
        .run();

      if (nextStatus === "active") {
        summary.active += 1;
      } else if (nextStatus === "verifying") {
        summary.verifying += 1;
      } else if (nextStatus === "expired") {
        summary.expired += 1;
      } else {
        summary.failed += 1;
      }
    } catch (err) {
      summary.errors += 1;
      logError("Reverification error", {
        domainId: domain.id,
        domain: domain.domain,
        error: err instanceof Error ? err.message : String(err),
      }, { module: "custom-domain-maintenance" });
    }
  }

  return summary;
}

export interface ReconcileStuckDomainsSummary {
  scanned: number;
  cleaned: number;
  reset: number;
  errors: number;
}

export async function reconcileStuckDomains(
  env: Env,
  options?: { staleThresholdMs?: number },
): Promise<ReconcileStuckDomainsSummary> {
  const db = getDb(env.DB);
  const thresholdMs = options?.staleThresholdMs ?? 60 * 60 * 1000; // 1 hour
  const oneHourAgo = new Date(Date.now() - thresholdMs).toISOString();

  const stuckDomains = await db.select()
    .from(serviceCustomDomains)
    .where(
      or(
        and(
          eq(serviceCustomDomains.status, "dns_verified"),
          isNotNull(serviceCustomDomains.cfCustomHostnameId),
          lt(serviceCustomDomains.updatedAt, oneHourAgo),
        ),
        and(
          eq(serviceCustomDomains.status, "ssl_pending"),
          lt(serviceCustomDomains.updatedAt, oneHourAgo),
        ),
      ),
    )
    .all();

  const summary: ReconcileStuckDomainsSummary = {
    scanned: stuckDomains.length,
    cleaned: 0,
    reset: 0,
    errors: 0,
  };

  for (const domain of stuckDomains) {
    try {
      if (domain.status === "dns_verified" && domain.cfCustomHostnameId) {
        // Double-failure orphan: dns_verified with a stale managed hostname ID.
        // Clean up the orphaned external hostname and reset DB state.
        await deleteManagedCustomHostname(env, domain.cfCustomHostnameId);
        await db.update(serviceCustomDomains)
          .set({
            cfCustomHostnameId: null,
            sslStatus: null,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(serviceCustomDomains.id, domain.id))
          .run();
        logWarn("Cleaned orphaned managed custom hostname", {
          module: "custom-domain-maintenance",
          ...{
            domainId: domain.id,
            domain: domain.domain,
            customHostnameId: domain.cfCustomHostnameId,
          },
        });
        summary.cleaned += 1;
      } else if (domain.status === "ssl_pending") {
        // ssl_pending stuck > 1 hour — check managed hostname status
        if (!domain.cfCustomHostnameId) {
          // No managed hostname — reset to dns_verified for retry
          await db.update(serviceCustomDomains)
            .set({
              status: "dns_verified",
              sslStatus: null,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(serviceCustomDomains.id, domain.id))
            .run();
          summary.reset += 1;
          continue;
        }

        const hostnameStatus = await getManagedCustomHostnameStatus(
          env,
          domain.cfCustomHostnameId,
        );

        if (!hostnameStatus) {
          // Provider returned null/error — hostname gone, reset for retry
          await db.update(serviceCustomDomains)
            .set({
              status: "dns_verified",
              cfCustomHostnameId: null,
              sslStatus: null,
              updatedAt: new Date().toISOString(),
            })
            .where(eq(serviceCustomDomains.id, domain.id))
            .run();
          summary.reset += 1;
        } else if (SSL_FAILURE_STATES.has(hostnameStatus.sslStatus)) {
          // Provider reports failure
          await db.update(serviceCustomDomains)
            .set({
              status: "ssl_failed",
              sslStatus: "failed",
              updatedAt: new Date().toISOString(),
            })
            .where(eq(serviceCustomDomains.id, domain.id))
            .run();
          await deleteHostnameRouting({ env, hostname: domain.domain });
          summary.cleaned += 1;
        }
        // If still pending at the provider, leave alone — provisioning can be slow
      }
    } catch (err) {
      summary.errors += 1;
      logError("Stuck domain reconciliation error", {
        domainId: domain.id,
        domain: domain.domain,
        error: err instanceof Error ? err.message : String(err),
      }, { module: "custom-domain-maintenance" });
    }
  }

  return summary;
}
